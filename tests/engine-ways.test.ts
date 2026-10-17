import { describe, expect, it } from 'vitest';
import {
  act, actsOn, addObstacle, cleanReply, compileContext, contextPlan, continuing, planAsText, replyFrom, setReply, wantedAsYou, difficultyFor, loadModule, planCheck, playable, randomDifficulty, read, say, setState, settleCheck, startSave, stateDefFor, subjectsHere,
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
    expect(value(module, added, 'health', 'crowd')).toBe(1);
    expect(subjectsHere(module, added).map((subject) => subject.id)).toContain('crowd');
  });

  it('settles a deed: it works, or it fails at the approach\'s cost', () => {
    const save = startSave(module);
    const deed: Target = { owner: 'gate-arbiter', defId: null };
    const plan = must(planCheck(module, save, deed, { approach: 'finesse', charge: 0 }));
    expect(plan.stakes.success).toBe('What you are trying works.');
    const won = must(act(module, save, 't1', { type: 'check', target: deed, choice: { approach: 'finesse', charge: 0 }, input: 'I lift her pen while she writes.', random: rollFor(module, save, deed, 'finesse', true) }));
    expect(won.turn.directive).toMatch(/^It works\./);
    expect(won.turn.check?.target).toEqual({ owner: 'gate-arbiter', defId: null, label: 'The gate Arbiter · Lift, slip past or plant something' });
    const lost = must(act(module, save, 't1', { type: 'check', target: deed, choice: { approach: 'finesse', charge: 0 }, input: 'I lift her pen.', random: rollFor(module, save, deed, 'finesse', false) }));
    expect(lost.turn.directive).toBe('It fails.\nEveryone at the landward gate is uneasy and keeps an eye on you.');
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
  it('says plainly what a success did and what it means, and keeps it true afterwards', () => {
    const save = startSave(module);
    const sway: Target = { owner: 'gate-guard', defId: 'strain' };
    const input = "You don't recognize me? I already work here, *I lie.*";
    const won = must(act(module, save, 't1', { type: 'check', target: sway, choice: { approach: 'flair', charge: 0 }, input, random: rollFor(module, save, sway, 'flair', true) }));
    expect(won.turn.directive).toBe('It works.\nThe garrison guard has given way. He will take your word over anything he can see or know, and do as you ask, until something new changes his mind.');
    const plan = contextPlan(module, won.save);
    expect(plan.messages.at(-1)).toEqual({ role: 'user', content: input });
    // Said once: the outcome carries it this turn, so the conditions kept true leave it out.
    expect(plan.prefill.match(/has given way/g)).toHaveLength(1);
    expect(plan.prefill).toContain('\n- Show that it works.\n- Show that the garrison guard has given way. He will take your word over anything he can see or know, and do as you ask, until something new changes his mind.\n');
    // Next turn it is a condition to keep true, and the outcome stays with the words that won it.
    const replied = must(setReply(won.save, 't1', '*He shrugs.* Didn’t know your face.')).save;
    const later = contextPlan(module, must(say(module, replied, 't2', 'I nod to him and walk on.')).save);
    expect(later.prefill).toContain('\n- Remember that the garrison guard has given way. He will take your word over anything he can see or know, and do as you ask, until something new changes his mind.\n');
    expect(later.prefill).not.toContain('- Show that');
    // Resolved: only the story remains.
    expect(later.messages.some((message) => message.role === 'user' && message.content === input)).toBe(true);
  });

  it('says when it is not over yet, and what that means', () => {
    const save = startSave(module);
    const sway: Target = { owner: 'gate-arbiter', defId: 'strain' };
    const partial = must(act(module, save, 't1', { type: 'check', target: sway, choice: { approach: 'flair', charge: 0 }, input: 'You will find I have already signed.', random: rollFor(module, save, sway, 'flair', true) }));
    expect(partial.turn.directive).toMatch(/^It gains ground, but it is not over yet\.\nThe gate Arbiter is (wavering, no longer sure of her ground but still holding out|close to giving way\. She will hold out a little longer, but not much)\.$/);
    const hit: Target = { owner: 'gate-arbiter', defId: 'health' };
    const struck = must(act(module, save, 't1', { type: 'check', target: hit, choice: { approach: 'force', charge: 0 }, input: 'I hit her.', random: rollFor(module, save, hit, 'force', true) }));
    expect(struck.turn.directive).toMatch(/\nThe gate Arbiter is (bruised, shaken but still fighting|hurt, bleeding and slowed, but still fighting|near death\. One more good blow could drop her)\./);
  });

  it('turns a note about them into one about you, or uses the player\'s own', () => {
    const save = must(setState(module, startSave(module), 'health', 'traveller', 1)).save;
    const hit: Target = { owner: 'gate-guard', defId: 'health' };
    const lost = must(act(module, save, 't1', { type: 'check', target: hit, choice: { approach: 'force', charge: 0 }, input: 'I swing at him.', random: rollFor(module, save, hit, 'force', false) }));
    expect(lost.turn.directive).toBe('It fails and makes no headway against the garrison guard.\nYou are down. You can do nothing more in this scene.\nEveryone at the landward gate is uneasy and keeps an eye on you.');
  });

  it('says outright whether what you wanted happens', () => {
    expect(wantedAsYou('She lets me through without signing.')).toBe('she lets you through without signing');
    expect(wantedAsYou("I'm waved through and my name is never written")).toBe("you're waved through and your name is never written");
    const save = startSave(module);
    const intent = 'She lets me through without signing.';
    const guard: Target = { owner: 'gate-guard', defId: 'strain' };
    const won = must(act(module, save, 't1', { type: 'check', target: guard, choice: { approach: 'flair', charge: 0, intent }, input: 'I work here.', random: rollFor(module, save, guard, 'flair', true) }));
    expect(won.turn.directive).toMatch(/^It works: she lets you through without signing\.\nThe garrison guard has given way\. He will /);
    expect(won.turn.check?.intent).toBe(intent);
    const arbiter: Target = { owner: 'gate-arbiter', defId: 'strain' };
    const partial = must(act(module, save, 't1', { type: 'check', target: arbiter, choice: { approach: 'flair', charge: 0, intent }, input: 'I work here.', random: rollFor(module, save, arbiter, 'flair', true) }));
    expect(partial.turn.directive).toMatch(/^It gains ground, but it is not over yet\.\nThis does not happen yet: she lets you through without signing\.\nThe gate Arbiter is /);
    const lost = must(act(module, save, 't1', { type: 'check', target: arbiter, choice: { approach: 'flair', charge: 0, intent }, input: 'I work here.', random: rollFor(module, save, arbiter, 'flair', false) }));
    expect(lost.turn.directive).toMatch(/^It fails and makes no headway against the gate Arbiter\.\nThis does not happen: she lets you through without signing\./);
    // Settled without a roll, it still happens.
    const sure = must(act(module, save, 't1', { type: 'check', target: { owner: 'gate-arbiter', defId: null }, choice: { approach: 'finesse', charge: 0, intent: 'I slip past her' }, input: 'I slip past.', random: null }));
    expect(sure.turn.directive).toBe('It works: you slip past her.');
  });

  it('can be copied whole, with the replies that came back', () => {
    const save = must(say(module, startSave(module), 't1', 'I look.')).save;
    const text = planAsText(contextPlan(module, save), ['*Fog.*', '*Rain.*']);
    expect(text).toMatch(/^=== Instructions and world · system ===\nYou narrate a text adventure\./);
    expect(text).toContain('\n\n=== Story so far and lore · system ===\n[ You are the traveller: ');
    expect(text).toContain("\n\n=== The reply's opening · prefill ===\nUnderstood. I will:\n");
    expect(text.endsWith('=== Reply 1 of 2 ===\n*Fog.*\n\n=== Reply 2 of 2 ===\n*Rain.*\n')).toBe(true);
  });

  it('lets Focus show what was learned', () => {
    const save = startSave(module);
    const study: Target = { owner: 'gate-arbiter', defId: 'leverage' };
    const won = must(act(module, save, 't1', { type: 'check', target: study, choice: { approach: 'focus', charge: 0 }, input: 'I watch her hands.', random: rollFor(module, save, study, 'focus', true) }));
    expect(won.turn.directive).toMatch(/^It works, and you notice something useful about the gate Arbiter\.\nYou have (something|real leverage) on the gate Arbiter\./);
  });

  it('writes the reply\'s opening as clean sentences, one to a line', () => {
    let save = must(setState(module, startSave(module), 'strain', 'traveller', 3)).save;
    const arbiter: Target = { owner: 'gate-arbiter', defId: 'strain' };
    save = must(act(module, save, 't1', { type: 'check', target: arbiter, choice: { approach: 'flair', charge: 0, intent: 'She believes my lie and lets me through.' }, input: 'I signed last night.', random: rollFor(module, save, arbiter, 'flair', true) })).save;
    const lines = contextPlan(module, save).prefill.split('\n');
    expect(lines[0]).toBe('Understood. I will:');
    expect(lines.at(-2)).toBe('[Of course, here you go:]');
    for (const line of lines.slice(1, -2)) {
      expect(line).toMatch(/^- [A-Z][^\n]*\.$/);
      expect((line.match(/: /g) ?? []).length).toBeLessThanOrEqual(1);
    }
    expect(lines).toContain('- Show that this does not happen yet: she believes your lie and lets you through.');
    expect(lines).toContain('- Remember that you are strained.');
  });

  it('carries on from a reply edited up to a point', () => {
    const save = must(say(module, startSave(module), 't1', 'I wait.')).save;
    const plan = continuing(contextPlan(module, save), '*The Arbiter looks up');
    expect(plan.prefill.endsWith('[Of course, here you go:]\n*The Arbiter looks up')).toBe(true);
    expect(replyFrom(plan, ' at last.* Name.')).toBe('*The Arbiter looks up at last.* Name.');
  });

  it('never lets a side effect undo a success', () => {
    const save = startSave(module);
    const target: Target = { owner: 'gate-arbiter', defId: 'strain' };
    // A seeded sequence of rolls, searched for a success that also brings threat.
    const seeded = (seed: number) => { let k = seed; return () => { k = (k * 1103515245 + 12345) % 2147483648; return k / 2147483648; }; };
    let found = '';
    for (let seed = 0; seed < 3000 && !found; seed += 1) {
      const settled = settleCheck(module, save, target, { approach: 'flair', charge: 0 }, seeded(seed * 7919));
      if (settled.ok && settled.outcome.record.succeeded && settled.outcome.record.netAdvantage < 0) found = settled.outcome.directive;
    }
    expect(found).toMatch(/\nSomething (small goes against you as well|else goes wrong for you too), without undoing what you achieved\./);
    expect(replyFrom({ replyStart: '*Your heel smacks into his helm' }, ' with a sharp crack.*')).toBe('*Your heel smacks into his helm with a sharp crack.*');
    const plan = continuing(contextPlan(module, must(say(module, save, 't1', 'I kick.')).save), '*Your heel smacks into his helm ');
    expect(plan.prefill.endsWith('*Your heel smacks into his helm')).toBe(true);
  });

  it('keeps game notes out of the story if the model copies one', () => {
    expect(cleanReply('[ Scene: The landward gate. ]\n*Fog.* Name.\n[ Outcome: Flair succeeds. ]', 'x')).toBe('*Fog.* Name.');
    expect(cleanReply('Understood. I will:\n- Continue\n[Of course, here you go:]\n*Fog.* Name.', 'x')).toBe('*Fog.* Name.');
    expect(cleanReply('*She looks up.* [a note of my own] stays.', 'x')).toBe('*She looks up.* [a note of my own] stays.');
  });
});
