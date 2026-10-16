// The generation test: measures whether NovelAI reuses a long prompt it has just read,
// for one model or two, and reports it in words with the numbers to copy back.
import { useEffect, useRef, useState, type RefObject } from 'react';
import { systemPrefix } from '../engine';
import type { PlayApi } from './Play';
import { BackIcon } from './icons';
import { NarrationError, narrate, type Diagnostics } from './novelai';
import { LARGE, SMALL, summarize, testMessages, testPlan, timeOf, type Sample, type Step, type StepKind } from './gentest';

const KIND: Record<StepKind, string> = {
  short: 'Short prompt',
  cold: 'Fresh long prompt',
  exact: 'Same prompt again',
  prefix: 'Same notes, new ending',
  after: 'Again, after the other model',
};

const seconds = (ms: number | null) => (ms === null ? '–' : `${(ms / 1000).toFixed(1)} s`);
const sizeWords = (size: number) => (size ? `${(size / 1000).toFixed(0)}k` : 'short');

function numberIn(record: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function GenerationTestPanel({ api, headRef, onBack }: { api: PlayApi; headRef: RefObject<HTMLDivElement>; onBack: () => void }) {
  const { connection, prefs } = api;
  const models = connection.models.length ? connection.models : [connection.model];
  const [first, setFirst] = useState(connection.model);
  const [second, setSecond] = useState(prefs.helperModel && prefs.helperModel !== connection.model && models.includes(prefs.helperModel) ? prefs.helperModel : '');
  const [samples, setSamples] = useState<Sample[]>([]);
  const [running, setRunning] = useState<{ at: number; of: number; step: Step } | null>(null);
  const [copied, setCopied] = useState(false);
  const stopper = useRef<AbortController | null>(null);
  useEffect(() => () => stopper.current?.abort(), []);

  const chosen = second && second !== first ? [first, second] : [first];
  const plan = testPlan(chosen);

  async function run() {
    const controller = new AbortController();
    stopper.current = controller;
    const runId = Math.random().toString(36).slice(2, 8);
    const source = systemPrefix(api.world, api.save);
    const results: Sample[] = [];
    setSamples([]);
    setCopied(false);
    for (const [index, step] of plan.entries()) {
      if (controller.signal.aborted) break;
      setRunning({ at: index + 1, of: plan.length, step });
      const messages = testMessages(step, runId, source, api.save.options.tokensPerChar);
      const started = performance.now();
      let sample: Sample;
      try {
        const reply = await narrate(messages, step.model, connection.mode, { maxTokens: 16, temperature: 0, signal: controller.signal });
        sample = {
          step,
          ok: true,
          ms: Math.round(performance.now() - started),
          upstreamMs: numberIn(reply.diagnostics, 'upstreamMs'),
          promptTokens: numberIn(reply.usage, 'prompt_tokens'),
          completionTokens: numberIn(reply.usage, 'completion_tokens'),
        };
      } catch (error) {
        if (controller.signal.aborted) break;
        const diagnostics: Diagnostics | null = error instanceof NarrationError ? error.diagnostics : null;
        sample = {
          step,
          ok: false,
          ms: Math.round(performance.now() - started),
          upstreamMs: numberIn(diagnostics, 'upstreamMs'),
          promptTokens: null,
          completionTokens: null,
          error: error instanceof Error ? error.message : 'The call failed.',
        };
      }
      results.push(sample);
      setSamples([...results]);
    }
    if (stopper.current === controller) stopper.current = null;
    setRunning(null);
  }

  function stop() {
    stopper.current?.abort();
    stopper.current = null;
    setRunning(null);
  }

  const summary = summarize(samples);
  const report = {
    test: 'praxis-generation-test/1',
    version: __PRAXIS_VERSION__,
    at: new Date().toISOString(),
    mode: connection.mode,
    sizes: { small: SMALL, large: LARGE },
    summary: summary.map(({ verdicts, ...rest }) => ({ ...rest, verdicts })),
    samples: samples.map((sample) => ({
      model: sample.step.model, kind: sample.step.kind, size: sample.step.size, key: sample.step.key,
      ok: sample.ok, ms: sample.ms, upstreamMs: sample.upstreamMs, promptTokens: sample.promptTokens, completionTokens: sample.completionTokens, error: sample.error,
    })),
  };

  return (
    <div>
      <div className="panel-head" ref={headRef} tabIndex={-1}>
        <button type="button" className="btn quiet" onClick={onBack} style={{ paddingLeft: 4 }}><BackIcon />Menu</button>
        <h1>Generation test</h1>
        <span className="spacer" />
      </div>
      <div className="panel-body">
        <p className="meta" style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--text-2)' }}>
          Measures whether NovelAI reuses a long prompt it has just read, and whether switching models loses that. The answer decides how Praxis can afford extra calls, such as the journal’s and the evaluator’s. It makes {plan.length} short replies on your key and takes a few minutes. Stay on this page while it runs.
        </p>

        {!connection.connected ? (
          <p className="notice warn" role="alert">Connect NovelAI in Settings first.</p>
        ) : (
          <>
            <div className="card">
              <div className="lr stack">
                <label htmlFor="test-first" className="name">Narration model</label>
                <select id="test-first" className="select" value={first} disabled={Boolean(running)} onChange={(event) => setFirst(event.target.value)}>
                  {models.map((model) => <option key={model} value={model}>{model}</option>)}
                </select>
              </div>
              <div className="lr stack">
                <label htmlFor="test-second" className="name">Second model</label>
                <select id="test-second" className="select" value={second} disabled={Boolean(running)} onChange={(event) => setSecond(event.target.value)}>
                  <option value="">None</option>
                  {models.filter((model) => model !== first).map((model) => <option key={model} value={model}>{model}</option>)}
                </select>
                <span className="meta" style={{ lineHeight: 1.45 }}>Optional. Tests whether calls on a second model cost the first model its reuse.</span>
              </div>
            </div>

            {running ? (
              <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p className="writing">Call {running.at} of {running.of}: {KIND[running.step.kind].toLowerCase()}, {sizeWords(running.step.size)}, on {running.step.model}</p>
                <button type="button" className="btn" onClick={stop}>Stop</button>
              </div>
            ) : (
              <button type="button" className="btn primary wide" onClick={() => void run()}>{samples.length ? 'Run again' : 'Start the test'}</button>
            )}
          </>
        )}

        {summary.map((entry) => (
          <div key={entry.model} className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p className="name" style={{ fontSize: 17 }}>{entry.model}</p>
            <div className="two">
              <div className="stat"><b>{seconds(entry.short)}</b><span>short prompt</span></div>
              <div className="stat"><b>{seconds(entry.coldSmall)}</b><span>fresh, {sizeWords(SMALL)} tokens</span></div>
              <div className="stat"><b>{seconds(entry.coldLarge)}</b><span>fresh, {sizeWords(LARGE)} tokens</span></div>
              <div className="stat"><b>{seconds(entry.exact)}</b><span>same prompt again</span></div>
              <div className="stat"><b>{seconds(entry.prefix)}</b><span>same notes, new ending</span></div>
              {entry.after !== null && <div className="stat"><b>{seconds(entry.after)}</b><span>after the other model</span></div>}
            </div>
            {entry.perThousand !== null && <p className="meta">Reading costs about {entry.perThousand} ms per thousand prompt tokens.</p>}
            {!running && entry.verdicts.map((line) => <p key={line} style={{ fontSize: 15, lineHeight: 1.5 }}>{line}</p>)}
          </div>
        ))}

        {samples.length > 0 && (
          <details className="card">
            <summary className="lr" style={{ borderTop: 0 }}><span className="name grow">Every call</span><span className="meta">{samples.length}</span></summary>
            <ol className="ledger">
              {samples.map((sample, index) => (
                <li key={index} style={{ flexWrap: 'wrap' }}>
                  <span className="what" style={{ flex: '1 1 100%' }}>{index + 1}. {KIND[sample.step.kind]}, {sizeWords(sample.step.size)}, {sample.step.model}</span>
                  <span className={sample.ok ? 'meta mono' : 'bad'}>
                    {sample.ok
                      ? `${seconds(timeOf(sample))}${sample.promptTokens ? ` · ${sample.promptTokens.toLocaleString('en-US')} tokens in` : ''}${sample.completionTokens !== null ? ` · ${sample.completionTokens} out` : ''}`
                      : sample.error}
                  </span>
                </li>
              ))}
            </ol>
          </details>
        )}

        {samples.length > 0 && !running && (
          <button
            type="button"
            className="btn wide"
            onClick={() => { void navigator.clipboard?.writeText(JSON.stringify(report, null, 2)).then(() => setCopied(true)); }}
          >
            {copied ? 'Copied' : 'Copy the results'}
          </button>
        )}
        {samples.length > 0 && !running && <p className="hint">Paste them into the chat with Claude.</p>}
      </div>
    </div>
  );
}
