// The generation test: does NovelAI reuse a repeated prompt prefix, and does switching
// models lose it? NovelAI reports no cached-token count, so this is measured by time. A long
// prompt costs more time than a short one only while it is being read; if a repeat of the
// same long prompt comes back about as fast as a short one, the reading was reused.
//
// Pure: the plan, the prompts and the arithmetic. The panel runs the calls.
import type { ChatMessage } from '../engine';

export type StepKind = 'short' | 'cold' | 'exact' | 'prefix' | 'after';

export interface Step {
  model: string;
  kind: StepKind;
  // Roughly how many tokens of notes the prompt carries; 0 for the short prompt.
  size: number;
  // Prompts with the same key share their notes word for word.
  key: string;
  // The word the reply is asked for. Different words make different endings.
  word: string;
}

export interface Sample {
  step: Step;
  ok: boolean;
  // Measured in the browser, and on the Praxis server around NovelAI's answer.
  ms: number;
  upstreamMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  error?: string;
}

export const SMALL = 4000;
export const LARGE = 16000;
const WORDS = ['ready', 'done', 'yes', 'fine', 'clear', 'good', 'noted'];

// The order of calls. Per model: three short prompts for the fixed cost of any call; two
// fresh small prompts and a fresh large one for the cost of reading; the large one again
// word for word, then with different endings; and a second fresh large one. With two
// models, the first model's large prompt is tried again after the second model has run.
export function testPlan(models: string[]): Step[] {
  const steps: Step[] = [];
  models.forEach((model, index) => {
    const key = (name: string) => `${index}-${name}`;
    for (let i = 0; i < 3; i += 1) steps.push({ model, kind: 'short', size: 0, key: key('short'), word: WORDS[0] });
    steps.push({ model, kind: 'cold', size: SMALL, key: key('s1'), word: WORDS[0] });
    steps.push({ model, kind: 'cold', size: SMALL, key: key('s2'), word: WORDS[0] });
    steps.push({ model, kind: 'cold', size: LARGE, key: key('l1'), word: WORDS[0] });
    steps.push({ model, kind: 'exact', size: LARGE, key: key('l1'), word: WORDS[0] });
    steps.push({ model, kind: 'exact', size: LARGE, key: key('l1'), word: WORDS[0] });
    steps.push({ model, kind: 'prefix', size: LARGE, key: key('l1'), word: WORDS[1] });
    steps.push({ model, kind: 'prefix', size: LARGE, key: key('l1'), word: WORDS[2] });
    // A second fresh large prompt last, so it cannot push the first out before its repeats.
    steps.push({ model, kind: 'cold', size: LARGE, key: key('l2'), word: WORDS[0] });
  });
  if (models.length > 1) {
    steps.push({ model: models[0], kind: 'after', size: LARGE, key: '0-l1', word: WORDS[0] });
    steps.push({ model: models[0], kind: 'after', size: LARGE, key: '0-l1', word: WORDS[3] });
  }
  return steps;
}

// The prompt for a step: a marker that makes this run's notes unlike any earlier run's,
// the notes cut to size from the source text, and the request for one word.
export function testMessages(step: Step, runId: string, source: string, tokensPerChar: number): ChatMessage[] {
  const marker = `Test ${runId}-${step.key}.`;
  if (!step.size) {
    return [
      { role: 'system', content: `${marker} Answer exactly as asked.` },
      { role: 'user', content: `Reply with the single word "${step.word}" and nothing else.` },
    ];
  }
  const want = Math.round(step.size / tokensPerChar);
  const base = source.trim() || 'Notes.';
  let notes = '';
  for (let part = 1; notes.length < want; part += 1) notes += `\n\n[Part ${part}]\n${base}`;
  return [
    { role: 'system', content: `${marker} Read the notes below, then answer exactly as asked.${notes.slice(0, want)}` },
    { role: 'user', content: `Reply with the single word "${step.word}" and nothing else.` },
  ];
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

// The time a sample counts for: the server's measure of NovelAI when there is one.
export const timeOf = (sample: Sample) => sample.upstreamMs ?? sample.ms;

export interface ModelSummary {
  model: string;
  short: number | null;
  coldSmall: number | null;
  coldLarge: number | null;
  exact: number | null;
  prefix: number | null;
  after: number | null;
  // Milliseconds per thousand prompt tokens read, from the fresh small and large prompts.
  perThousand: number | null;
  // How much of the reading time a repeat saved, from 0 (none) to 1 (all of it).
  exactSaved: number | null;
  prefixSaved: number | null;
  afterSaved: number | null;
  verdicts: string[];
}

function saved(cold: number | null, repeat: number | null, short: number | null): number | null {
  if (cold === null || repeat === null || short === null || cold - short <= 0) return null;
  return Math.max(0, Math.min(1, (cold - repeat) / (cold - short)));
}

function word(share: number | null): string {
  if (share === null) return 'could not be measured';
  if (share >= 0.5) return `reused, about ${Math.round(share * 100)}% of the reading time saved`;
  if (share >= 0.2) return `perhaps partly reused, about ${Math.round(share * 100)}% saved`;
  return 'no sign of reuse';
}

export function summarize(samples: Sample[]): ModelSummary[] {
  const models = [...new Set(samples.map((sample) => sample.step.model))];
  return models.map((model) => {
    const ok = samples.filter((sample) => sample.ok && sample.step.model === model);
    const times = (kind: StepKind, size?: number) => median(ok.filter((sample) => sample.step.kind === kind && (size === undefined || sample.step.size === size)).map(timeOf));
    const tokens = (size: number) => median(ok.filter((sample) => sample.step.kind === 'cold' && sample.step.size === size && sample.promptTokens).map((sample) => sample.promptTokens as number));
    const short = times('short');
    const coldSmall = times('cold', SMALL);
    const coldLarge = times('cold', LARGE);
    const exact = times('exact');
    const prefix = times('prefix');
    const after = times('after');
    const smallTokens = tokens(SMALL) ?? SMALL;
    const largeTokens = tokens(LARGE) ?? LARGE;
    const perThousand = coldSmall !== null && coldLarge !== null && largeTokens > smallTokens
      ? Math.round((coldLarge - coldSmall) / ((largeTokens - smallTokens) / 1000))
      : null;
    const exactSaved = saved(coldLarge, exact, short);
    const prefixSaved = saved(coldLarge, prefix, short);
    const afterSaved = saved(coldLarge, after, short);
    const verdicts: string[] = [];
    if (coldLarge !== null && short !== null && coldLarge - short < 1000) {
      verdicts.push('A long prompt costs less than a second more than a short one, so reuse cannot be told apart by time, and hardly matters on this model.');
    } else {
      verdicts.push(`Same long prompt again: ${word(exactSaved)}.`);
      verdicts.push(`Same notes, new ending: ${word(prefixSaved)}.`);
      if (after !== null) verdicts.push(`Again after the other model: ${word(afterSaved)}.`);
    }
    return { model, short, coldSmall, coldLarge, exact, prefix, after, perThousand, exactSaved, prefixSaved, afterSaved, verdicts };
  });
}
