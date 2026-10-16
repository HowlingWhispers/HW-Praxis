import { describe, expect, it } from 'vitest';
import {
  act, actsOn, addObstacle, cleanReply, compileContext, difficultyFor, loadModule, planCheck, playable, randomDifficulty, read, say, setState, settleCheck, startSave, stateDefFor, subjectsHere,
  type PraxisModule, type Save, type Target,
} from '../src/engine';
import { abernys, abernysRaw } from './abernys';

const module = abernys();

function must<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error((result as unknown as { reason: string }).reason);
  return result as Extract<T, { ok: true }>;
}

const value = (world: PraxisModule, save: Save, defId: string, owner: string) => {
  const layered = playable(world, save.local);
  return read(save.values, stateDefFor(layered, defId, owner)!, owner);
};
const always = (x: number) => () => x;

// A constant roll that makes this check come out the way the test needs.
function rollFor(world: PraxisModule, save: Save, target: Target, approach: string, succeed: boolean): () => number {
  for (let step = 0; step < 100; step += 1) {
    const random = always(step / 100);
    const settled = settleCheck(world, save, target, { approach, charge: 0 }, random);
    if (settled.ok && settled.outcome.record.succeeded === succeed && !settled.outcome.record.triumph && !settled.outcome.record.despair) return random;
  }
  throw new Error('No roll found.');
}

const summary = (world: PraxisModule, save: Save, id: string) => {
  const subject = subjectsHere(world, save).find((entry) => entry.id === id)!;
  return Object.fromEntries(actsOn(world, save, subject).map(({ approach, acts }) => [approach.id, acts.map((entry) => (entry.kind === 'deed' ? 'deed' : `${entry.def.id}${entry.claim === 'secondary' ? '?' : ''}`))]));
};

describe('every record, four ways', () => {
  it('offers the four approaches on people, things and the place without authoring', () => {
    let save = startSave(module);
    expect(summary(module, save, 'gate-arbiter')).toEqual({ force: ['health', 'strain?'], finesse: ['deed'], focus: ['leverage'], flair: ['strain'] });
    expect(summary(module, save, 'pc-landward-gate')).toEqual({ force: [], finesse: ['alert'], focus: ['prepared-place'], flair: [] });
    save = must(addObstacle(module, save, { id: 'door', kind: 'thing', name: 'The warehouse door', difficulty: 3 })).save;
    expect(summary(module, save, 'door')).toEqual({ force: ['integrity'], finesse: ['security'], focus: ['prepared'], flair: [] });
  });

  it('takes how hard it is from the record, its tier, or a random roll fixed by the save', () => {
    const save = startSave(module, 12345);
    expect(difficultyFor(module, save, 'gate-guard', 'force')).toBe(1);
    expect(difficultyFor(module, save, 'gate-arbiter', 'flair')).toBe(2);
    expect(difficultyFor(module, save, 'brond', 'force')).toBe(3);
    expect(difficultyFor(module, save, 'registry-strongroom', 'force')).toBe(4);
    expect(difficultyFor(module, save, 'registry-strongroom', 'focus')).toBe(2);
    const added = must(addObstacle(module, save, { id: 'crowd', kind: 'person', name: 'Two dock guards', tier: 'minion', difficulty: 'random' })).save;
    const rolled = difficultyFor(module, added, 'crowd', 'force');
    expect(rolled).toBe(randomDifficulty(12345, 'crowd', 'force'));
    expect(rolled).toBeGreaterThanOrEqual(1);
    expect(rolled).toBeLessThanOrEqual(4);
    expect(value(module, added, 'health', 'crowd')).toBe(2);
    expect(subjectsHere(module, added).map((subject) => subject.id)).toContain('crowd');
  });

  it('settles a deed: it works, or it fails at the approach\'s cost', () => {
    const save = startSave(module);
    const deed: Target = { owner: 'gate-arbiter', defId: null };
    const plan = must(planCheck(module, save, deed, { approach: 'finesse', charge: 0 }));
    expect(plan.stakes.success).toBe('What you are trying works.');
    const won = must(act(module, save, 't1', { type: 'check', target: deed, choice: { approach: 'finesse', charge: 0 }, input: 'I lift her pen while she writes.', random: rollFor(module, save, deed, 'finesse', true) }));
    expect(won.turn.directive).toMatch(/^Finesse succeeds\. What you just tried works on the gate Arbiter\./);
    expect(won.turn.directive).toMatch(/Show it in this reply, and let it change what the gate Arbiter does from here on\.$/);
    expect(won.turn.check?.target).toEqual({ owner: 'gate-arbiter', defId: null, label: 'The gate Arbiter · Lift, slip past or plant something' });
    const lost = must(act(module, save, 't1', { type: 'check', target: deed, choice: { approach: 'finesse', charge: 0 }, input: 'I lift her pen.', random: rollFor(module, save, deed, 'finesse', false) }));
    expect(lost.turn.directive).toMatch(/^Finesse fails\. What you just tried does not work on the gate Arbiter\. .*Everyone at the landward gate is uneasy\./);
    expect(value(module, lost.save, 'alert', 'pc-landward-gate')).toBe(1);
    expect(planCheck(module, save, deed, { approach: 'flair', charge: 0 })).toEqual({ ok: false, reason: 'Flair has nothing to do to the gate Arbiter on its own.' });
  });

  it('lets Focus build Leverage that makes a later check easier, and spends it there', () => {
    const save = startSave(module);
    const read_: Target = { owner: 'gate-arbiter', defId: 'leverage' };
    const studied = must(act(module, save, 't1', { type: 'check', target: read_, choice: { approach: 'focus', charge: 0 }, input: 'I watch how she handles the ledger.', random: rollFor(module, save, read_, 'focus', true) })).save;
    expect(value(module, studied, 'leverage', 'gate-arbiter')).toBeGreaterThanOrEqual(1);
    const strain: Target = { owner: 'gate-arbiter', defId: 'strain' };
    const helped = must(planCheck(module, studied, strain, { approach: 'flair', charge: 0 }));
    expect(helped.difficulty.final).toBeLessThan(helped.difficulty.base);
    expect(helped.reasons.some((reason) => reason.startsWith('Your Leverage:'))).toBe(true);
    const kept = must(planCheck(module, studied, strain, { approach: 'flair', charge: 0, useAids: false }));
    expect(kept.difficulty.final).toBe(kept.difficulty.base);
    // Focus does not help itself.
    expect(must(planCheck(module, studied, read_, { approach: 'focus', charge: 0 })).uses.aids).toEqual([]);
    const spent = must(act(module, studied, 't2', { type: 'check', target: strain, choice: { approach: 'flair', charge: 0 }, input: 'I lean on it.', random: always(0.5) })).save;
    expect(value(module, spent, 'leverage', 'gate-arbiter')).toBe(0);
  });

  it('lets Focus prepare against a thing, and Force break it open', () => {
    let save = must(addObstacle(module, startSave(module), { id: 'door', kind: 'thing', name: 'The warehouse door', difficulty: 2 })).save;
    const study: Target = { owner: 'door', defId: 'prepared' };
    save = must(act(module, save, 't1', { type: 'check', target: study, choice: { approach: 'focus', charge: 0 }, input: 'I look the door over.', random: rollFor(module, save, study, 'focus', true) })).save;
    const prepared = value(module, save, 'prepared', 'door');
    expect(prepared).toBeGreaterThanOrEqual(1);
    const smash: Target = { owner: 'door', defId: 'integrity' };
    const plan = must(planCheck(module, save, smash, { approach: 'force', charge: 0 }));
    expect(plan.pool.good.filter((die) => die === 'boost')).toHaveLength(prepared);
    let broken = save;
    for (let turn = 0; turn < 6 && value(module, broken, 'integrity', 'door') > 0; turn += 1) {
      broken = must(act(module, broken, `s${turn}`, { type: 'check', target: smash, choice: { approach: 'force', charge: 0 }, input: 'I put my shoulder to it.', random: always(0.5) })).save;
    }
    expect(value(module, broken, 'integrity', 'door')).toBe(0);
    expect(broken.turns.some((turn) => turn.directive?.includes('The warehouse door is broken. It gives way, and whatever it held shut is open now.'))).toBe(true);
    expect(broken.turns.at(-1)!.directive).toBeTruthy();
  });

  it('makes any world playable through the standard ruleset', () => {
    const raw = structuredClone(abernysRaw) as Record<string, any>;
    raw.ruleset = { extends: 'four-approaches/1', travel: raw.ruleset.travel };
    raw.relationships = [];
    raw.items = [];
    for (const route of raw.world.routes) route.requires = [];
    for (const character of raw.characters) delete character.tier;
    const loaded = loadModule(raw);
    if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
    const world = loaded.module;
    expect(world.ruleset.approaches.map((approach) => approach.id)).toEqual(['force', 'finesse', 'focus', 'flair']);
    expect(summary(world, startSave(world), 'gate-guard')).toEqual({ force: ['health', 'strain?'], finesse: ['deed'], focus: ['leverage'], flair: ['strain'] });
  });
});

describe('what the narrator is told', () => {
  it('says plainly what a success did, what it means, and that it carries on', () => {
    const save = startSave(module);
    const sway: Target = { owner: 'gate-guard', defId: 'strain' };
    const won = must(act(module, save, 't1', { type: 'check', target: sway, choice: { approach: 'flair', charge: 0 }, input: "You don't recognize me? I already work here, *I lie.*", random: rollFor(module, save, sway, 'flair', true) }));
    expect(won.turn.directive).toMatch(/^Flair succeeds\. What you just tried works on the garrison guard\. The garrison guard has given way to you: they believe you, back down or do as you ask\. They stay that way unless something new changes their mind\./);
    expect(won.turn.directive).toMatch(/Show it in this reply, and let it change what the garrison guard does from here on\.$/);
    const messages = compileContext(module, won.save);
    const notes = messages.at(-2)!.content;
    expect(messages.at(-2)!.role).toBe('system');
    expect(messages.at(-1)).toEqual({ role: 'user', content: "You don't recognize me? I already work here, *I lie.*" });
    // Said once: the outcome carries it this turn, so the scene does not repeat it.
    expect(notes.match(/has given way to you/g)).toHaveLength(1);
    expect(notes).toMatch(/\n\[ Outcome: Flair succeeds\. .* \]$/);
    // Next turn the scene keeps saying it, and the outcome is gone.
    const later = compileContext(module, must(say(module, won.save, 't2', 'I nod to him and walk on.')).save).at(-2)!.content;
    expect(later).toMatch(/\[ Scene: .*The garrison guard has given way to you: they believe you, back down or do as you ask\./);
    expect(later).not.toContain('Outcome');
  });

  it('turns a note about them into one about you, or uses the player\'s own', () => {
    const save = must(setState(module, startSave(module), 'health', 'traveller', 1)).save;
    const hit: Target = { owner: 'gate-guard', defId: 'health' };
    const lost = must(act(module, save, 't1', { type: 'check', target: hit, choice: { approach: 'force', charge: 0 }, input: 'I swing at him.', random: rollFor(module, save, hit, 'force', false) }));
    expect(lost.turn.directive).toContain('You are down. You can do nothing more in this scene.');
    expect(lost.turn.directive).toContain('Everyone at the landward gate is uneasy.');
    expect(lost.turn.directive).toMatch(/let the garrison guard react to it\.$/);
  });

  it('lets Focus show what was learned', () => {
    const save = startSave(module);
    const study: Target = { owner: 'gate-arbiter', defId: 'leverage' };
    const won = must(act(module, save, 't1', { type: 'check', target: study, choice: { approach: 'focus', charge: 0 }, input: 'I watch her hands.', random: rollFor(module, save, study, 'focus', true) }));
    expect(won.turn.directive).toMatch(/^Focus succeeds\. You learn something useful about the gate Arbiter\. You have (something|real leverage) on the gate Arbiter\./);
    expect(won.turn.directive).toMatch(/Show what you notice in this reply\.$/);
  });

  it('keeps game notes out of the story if the model copies one', () => {
    expect(cleanReply('[ Scene: The landward gate. ]\n*Fog.* Name.\n[ Outcome: Flair succeeds. ]', 'x')).toBe('*Fog.* Name.');
    expect(cleanReply('*She looks up.* [a note of my own] stays.', 'x')).toBe('*She looks up.* [a note of my own] stays.');
  });
});
