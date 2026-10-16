import { describe, expect, it } from 'vitest';
import { LARGE, SMALL, summarize, testMessages, testPlan, type Sample, type Step } from '../src/ui/gentest';

describe('the generation test', () => {
  it('plans each model, then the first model again after the second', () => {
    const one = testPlan(['glm-4-6']);
    expect(one.length).toBe(11);
    expect(one.filter((step) => step.kind === 'after').length).toBe(0);
    const two = testPlan(['glm-4-6', 'xialong-v1']);
    expect(two.length).toBe(24);
    expect(two.slice(-2).every((step) => step.kind === 'after' && step.model === 'glm-4-6' && step.key === '0-l1')).toBe(true);
    // The repeats come straight after the prompt they repeat, before a second fresh one.
    const kinds = one.map((step) => step.kind).join(' ');
    expect(kinds).toBe('short short short cold cold cold exact exact prefix prefix cold');
  });

  it('builds prompts that share notes exactly when they share a key', () => {
    const plan = testPlan(['m']);
    const [fresh, , repeat, , ending] = plan.filter((step) => step.size === LARGE);
    const message = (step: Step) => testMessages(step, 'run1', 'The landward gate stands open in the fog.', 0.3);
    expect(message(fresh)[0].content).toBe(message(repeat)[0].content);
    expect(message(fresh)[1].content).toBe(message(repeat)[1].content);
    expect(message(ending)[0].content).toBe(message(fresh)[0].content);
    expect(message(ending)[1].content === message(fresh)[1].content).toBe(false);
    expect(Math.abs(message(fresh)[0].content.length - LARGE / 0.3)).toBeLessThan(200);
    const other = plan.find((step) => step.key === '0-l2') as Step;
    expect(message(other)[0].content === message(fresh)[0].content).toBe(false);
    expect(testMessages(fresh, 'run2', 'x', 0.3)[0].content === message(fresh)[0].content).toBe(false);
  });

  it('reads reuse from the times', () => {
    const plan = testPlan(['m']);
    const time: Record<string, number> = { short: 1000, cold: 0, exact: 1300, prefix: 1600 };
    const samples: Sample[] = plan.map((step) => ({
      step,
      ok: true,
      ms: 9999,
      upstreamMs: step.kind === 'cold' ? (step.size === SMALL ? 2000 : 5000) : time[step.kind],
      promptTokens: step.size || 40,
      completionTokens: 2,
    }));
    const [summary] = summarize(samples);
    expect(summary.short).toBe(1000);
    expect(summary.coldLarge).toBe(5000);
    expect(summary.perThousand).toBe(250);
    expect(summary.exactSaved).toBe(0.925);
    expect(summary.prefixSaved).toBe(0.85);
    expect(summary.verdicts[0]).toBe('Same long prompt again: reused, about 93% of the reading time saved.');
  });

  it('says when reading is too cheap to tell', () => {
    const samples: Sample[] = testPlan(['m']).map((step) => ({ step, ok: true, ms: 0, upstreamMs: step.size ? 1400 : 1000, promptTokens: null, completionTokens: null }));
    expect(summarize(samples)[0].verdicts.length).toBe(1);
    expect(summarize(samples)[0].verdicts[0].startsWith('A long prompt costs less than a second more')).toBe(true);
  });
});
