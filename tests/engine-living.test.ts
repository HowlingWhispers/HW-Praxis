import { describe, expect, it } from 'vitest';
import {
  act, bondBetween, bondsOf, bringAlong, contextPlan, doingNow, dueElsewhere, followRuleFor, followSchedules, leaveBehind, loadModule, pairKey,
  placeCharacter, planFor, read, rowAt, say, setClock, setState, settleCheck, startBond, startSave, stateDefFor, undoLastTurn, whereabouts,
  DEFAULT_CALENDAR, type PraxisModule, type Save,
} from '../src/engine';
import { abernys, abernysRaw } from './abernys';

const module = abernys();

function must<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error((result as unknown as { reason: string }).reason);
  return result as Extract<T, { ok: true }>;
}

const person = (id: string) => module.characters.find((character) => character.id === id)!;
const at = (hour: number, minute = 0, day = 0) => day * 1440 + hour * 60 + minute;
// The lorebook section and the reply's opening, where the game's notes for a turn go.
const momentOf = (save: Save) => {
  const plan = contextPlan(module, must(say(module, save, 'look', 'I look around.')).save);
  return `${plan.messages[1]!.content}\n${plan.prefill}`;
};

function withRaw(change: (raw: Record<string, any>) => void): ReturnType<typeof loadModule> {
  const raw = structuredClone(abernysRaw) as Record<string, any>;
  change(raw);
  return loadModule(raw);
}

describe('schedules', () => {
  it('pick the day by its rules and the stop by the hour, running past midnight', () => {
    const cadfan = person('cadfan').schedule!;
    // Day 4 of the real calendar is a Thursday, Cadfan's market day.
    expect(planFor(DEFAULT_CALENDAR, cadfan, at(9, 0, 4)).id).toBe('market');
    expect(planFor(DEFAULT_CALENDAR, cadfan, at(9, 0, 5)).id).toBe('day');
    const arbiter = person('gate-arbiter').schedule!.plans[0]!;
    expect(rowAt(arbiter, 7).locationId).toBe('pc-landward-gate');
    expect(rowAt(arbiter, 2).doing).toBe("asleep in the Arbiters' cells");
    const where = whereabouts(DEFAULT_CALENDAR, person('gate-arbiter'), at(23, 30))!;
    expect([where.from, where.until]).toEqual([at(22), at(6, 0, 1)]);
  });

  it('place people where their day has them when a save starts', () => {
    const save = startSave(module);
    expect(save.positions['ines-corvo']).toBe('pc-garrison');
    expect(save.positions['lucan-abreu']).toBe('pc-registry');
    expect(save.positions['gate-arbiter']).toBe('pc-landward-gate');
    expect(doingNow(module, save, person('gate-arbiter'))).toBe('keeping the ledger at the landward gate');
  });

  it('move people as the clock passes their stops, and tell the narrator who came and went', () => {
    const waited = must(act(module, startSave(module), 't1', { type: 'wait', minutes: 150 }));
    expect(waited.save.positions['ines-corvo']).toBe('pc-landward-gate');
    expect(waited.entries.some((entry) => entry.kind === 'move' && entry.characterId === 'ines-corvo' && entry.source === 'rule')).toBe(true);
    expect(waited.turn.directive).toMatch(/Meanwhile, Ines Corvo arrives\.$/);
    expect(momentOf(waited.save)).toContain('[ Ines Corvo, the garrison captain, of the Humans: ');
    expect(momentOf(waited.save)).toMatch(/\[ Present at the landward gate, [a-z ]+: .*Ines Corvo, the garrison captain, inspecting the gate and the road beyond it\./);
    const longer = must(act(module, startSave(module), 't1', { type: 'wait', minutes: 240 }));
    expect(longer.save.positions['ines-corvo']).toBe('pc-governors-court');
    expect(longer.turn.directive).toMatch(/Meanwhile, Ines Corvo comes by and goes on to the Governor's court\.$/);
    const back = must(undoLastTurn(waited.save));
    expect(back.save.positions['ines-corvo']).toBe('pc-garrison');
  });

  it('leave someone put by hand where they are until their next stop', () => {
    const moved = must(placeCharacter(module, startSave(module), 'gate-arbiter', 'pc-outside-walls')).save;
    const soon = must(act(module, moved, 't1', { type: 'wait', minutes: 30 })).save;
    expect(soon.positions['gate-arbiter']).toBe('pc-outside-walls');
    expect(doingNow(module, soon, person('gate-arbiter'))).toBe('');
    const evening = must(setClock(module, soon, at(19, 30))).save;
    expect(evening.positions['gate-arbiter']).toBe('pc-registry');
  });

  it('are checked when a module loads', () => {
    const bad = withRaw((raw) => {
      raw.characters.find((character: { id: string }) => character.id === 'gate-guard').schedule.plans[0].rows[0].locationId = 'nospier-point';
      raw.characters.find((character: { id: string }) => character.id === 'traveller').schedule = { plans: [{ id: 'x', name: 'X', rows: [{ fromHour: 0, locationId: 'pc-harbour' }] }] };
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.some((error) => error.includes('is an area, not somewhere to be'))).toBe(true);
      expect(bad.errors.some((error) => error.includes('The player character keeps no schedule'))).toBe(true);
    }
  });
});

describe('people you are with', () => {
  it('stay while you are with them, due elsewhere, and go when you wait or leave', () => {
    const arrived = must(act(module, startSave(module), 't1', { type: 'wait', minutes: 150 })).save;
    expect(arrived.positions['ines-corvo']).toBe('pc-landward-gate');
    // Your own turns hold her: two hours pass in talk, and she is still here.
    const later = arrived.clock + 120;
    const talked = followSchedules(module, { ...arrived, clock: later }, arrived.clock, later, { hold: true }).save;
    expect(talked.positions['ines-corvo']).toBe('pc-landward-gate');
    expect(talked.held).toEqual(['ines-corvo']);
    expect(dueElsewhere(module, talked, person('ines-corvo'))).toBe("The Governor's court");
    const lore = contextPlan(module, must(say(module, talked, 't2', 'I keep talking.')).save).messages[1]!.content;
    expect(lore).toContain("Ines Corvo, the garrison captain, due at the Governor's court by now");
    // Waiting lets her go.
    const waited = must(act(module, talked, 't3', { type: 'wait', minutes: 10 }));
    expect(waited.save.positions['ines-corvo']).toBe('pc-governors-court');
    expect(waited.save.held).toEqual([]);
    expect(waited.turn.directive).toMatch(/Meanwhile, Ines Corvo leaves for the Governor's court\.$/);
    // So does leaving her.
    const signed = must(act(module, talked, 't3', { type: 'scene', actionId: 'sign-the-covenant' })).save;
    const left = must(act(module, signed, 't4', { type: 'travel', to: 'pc-outside-walls' })).save;
    expect(left.positions['ines-corvo']).toBe('pc-governors-court');
    expect(left.held).toEqual([]);
  });
});

describe('followers', () => {
  it('come along when a rule lets them, travel with you, and keep no schedule', () => {
    let save = startSave(module);
    expect(followRuleFor(module, save, 'gate-guard')).toBe(null);
    expect(bringAlong(module, save, 'gate-guard')).toEqual({ ok: false, reason: 'Nothing makes a garrison guard come with you yet.' });
    save = must(setState(module, save, 'health', 'gate-guard', 0)).save;
    expect(followRuleFor(module, save, 'gate-guard')?.id).toBe('captive');
    save = must(bringAlong(module, save, 'gate-guard')).save;
    expect(save.following).toEqual({ 'gate-guard': 'captive' });
    expect(save.ledger.at(-1)).toMatchObject({ kind: 'follow', characterId: 'gate-guard', as: 'captive', source: 'rule' });
    expect(contextPlan(module, must(say(module, save, 't0', 'I bind his hands.')).save).messages[1]!.content).toContain('A garrison guard, your captive');
    const went = must(act(module, save, 't1', { type: 'travel', to: 'pc-outside-walls' }));
    expect(went.save.positions['gate-guard']).toBe('pc-outside-walls');
    expect(went.turn.directive).toMatch(/^You have just arrived at the outer lanes after [^,]+, with a garrison guard, your captive\./);
    // Hours pass, and his watch at the gate does not call him back.
    const later = must(act(module, went.save, 't2', { type: 'wait', minutes: 600 })).save;
    expect(later.positions['gate-guard']).toBe('pc-outside-walls');
    // Undo puts him back at the gate, still following.
    const undone = must(undoLastTurn(went.save)).save;
    expect(undone.positions['gate-guard']).toBe('pc-landward-gate');
    expect(undone.following).toEqual({ 'gate-guard': 'captive' });
  });

  it('stay behind when their reason no longer holds, and can be left or brought by hand', () => {
    let save = must(setState(module, startSave(module), 'health', 'gate-guard', 0)).save;
    save = must(bringAlong(module, save, 'gate-guard')).save;
    save = must(setState(module, save, 'health', 'gate-guard', 2)).save;
    const went = must(act(module, save, 't1', { type: 'travel', to: 'pc-outside-walls' }));
    expect(went.save.positions['gate-guard']).toBe('pc-landward-gate');
    expect(went.save.following).toEqual({});
    expect(went.turn.directive).toMatch(/ A garrison guard does not come with you\.$/);
    // A companion once the bond is warm enough: the warmest two tiers by default.
    let bonded = must(startBond(module, startSave(module), 'b1', 'gate-arbiter', 'bond-acquaintance')).save;
    const owner = bondBetween(module, bonded, 'traveller', 'gate-arbiter')!.owner;
    expect(followRuleFor(module, bonded, 'gate-arbiter')).toBe(null);
    bonded = must(setState(module, bonded, 'bond-acquaintance', owner, 3)).save;
    expect(followRuleFor(module, bonded, 'gate-arbiter')?.id).toBe('companion');
    // By hand, whatever the rules say, and recorded as yours.
    const forced = must(bringAlong(module, startSave(module), 'gate-arbiter', true)).save;
    expect(forced.following).toEqual({ 'gate-arbiter': 'by-hand' });
    expect(forced.ledger.at(-1)).toMatchObject({ kind: 'follow', source: 'player' });
    expect(must(leaveBehind(module, forced, 'gate-arbiter')).save.following).toEqual({});
  });
});

describe('relationships', () => {
  it('start with their authored tier and reach the narrator when both people are there', () => {
    const save = startSave(module);
    const rivals = stateDefFor(module, 'bond-rivals', pairKey('ottavio-marrane', 'lucan-abreu'))!;
    expect(read(save.values, rivals, pairKey('lucan-abreu', 'ottavio-marrane'))).toBe(2);
    const moment = momentOf(save);
    expect(moment).toContain('[ The gate Arbiter and the garrison guard: They keep the landward gate together every day');
    expect(moment).toMatch(/\[ The gate Arbiter and the garrison guard: .* Now: Each has done the other a good turn, and both remember it\. \]/);

    // At noon the Governor and the High Arbiter are both at court.
    const noon = must(setClock(module, save, at(12, 30))).save;
    const atCourt = must(placeCharacter(module, noon, 'traveller', 'pc-governors-court')).save;
    const courtMoment = momentOf(atCourt);
    expect(courtMoment).toContain('[ Ottavio Marrane and Lucan Abreu: The Governor leads the colony');
    expect(courtMoment).toContain('Ottavio Marrane wants the commission');
    expect(courtMoment).toMatch(/\[ Ottavio Marrane and Lucan Abreu: .* Now: They measure themselves against each other/);
  });

  it('can be started in play and set by hand, and go when the person does', () => {
    const save = startSave(module);
    expect(bondBetween(module, save, 'traveller', 'gate-arbiter')).toBe(null);
    const started = must(startBond(module, save, 'b1', 'gate-arbiter', 'bond-acquaintance')).save;
    const bond = bondBetween(module, started, 'traveller', 'gate-arbiter')!;
    expect(bond.tier).toBe("They know each other's names and not much else.");
    expect(bondsOf(module, started, 'traveller').map((entry) => entry.other.id)).toEqual(['gate-arbiter']);
    expect(startBond(module, started, 'b2', 'gate-arbiter', 'bond-friends').ok).toBe(false);
    const warmer = must(setState(module, started, 'bond-acquaintance', bond.owner, 3)).save;
    expect(warmer.ledger.at(-1)).toMatchObject({ kind: 'state', owner: pairKey('traveller', 'gate-arbiter'), source: 'player', to: 3 });
    expect(momentOf(warmer)).toMatch(/\[ The gate Arbiter and you: .*Now: Each has done the other a good turn, and both remember it\. \]/);
  });

  it('move a tier on a Flair triumph or despair against the other person', () => {
    const save = must(startBond(module, startSave(module), 'b1', 'gate-arbiter', 'bond-acquaintance')).save;
    const owner = pairKey('traveller', 'gate-arbiter');
    const def = stateDefFor(module, 'bond-acquaintance', owner)!;
    let seed = 1;
    const random = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
    let triumphs = 0;
    let despairs = 0;
    for (let tries = 0; tries < 400 && (!triumphs || !despairs); tries += 1) {
      const settled = settleCheck(module, save, { owner: 'gate-arbiter', defId: 'strain' }, { approach: 'flair', charge: 3 }, random);
      if (!settled.ok) throw new Error(settled.reason);
      const { record, save: after } = settled.outcome;
      const swing = (record.triumph ? 1 : 0) - (record.despair ? 1 : 0);
      expect(read(after.values, def, owner)).toBe(2 + swing);
      if (swing > 0) triumphs += 1;
      if (swing < 0) despairs += 1;
    }
    expect(triumphs).toBeGreaterThan(0);
    // Force does not own the bond, so a triumph with it leaves the bond alone.
    for (let tries = 0; tries < 200; tries += 1) {
      const settled = settleCheck(module, save, { owner: 'gate-arbiter', defId: 'health' }, { approach: 'force', charge: 2 }, random);
      if (!settled.ok) throw new Error(settled.reason);
      expect(read(settled.outcome.save.values, def, owner)).toBe(2);
    }
  });

  it('are checked when a module loads', () => {
    const bad = withRaw((raw) => {
      raw.relationships.push({ id: 'again', personIds: ['lucan-abreu', 'ottavio-marrane'] });
      raw.relationships.push({ id: 'odd', personIds: ['brond', 'cadfan'], bondStateId: 'strain' });
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.some((error) => error.includes('These two already have a relationship.'))).toBe(true);
      expect(bad.errors.some((error) => error.includes('"strain" is not a relationship state.'))).toBe(true);
    }
  });
});

describe('dossiers', () => {
  it('give the narrator how present people look, carry themselves and speak, within a budget', () => {
    const moment = momentOf(startSave(module));
    expect(moment).toContain("Looks: A woman in the Arbiters' grey");
    expect(moment).toContain('Speech: As few words as he can manage');
    // A crowded room keeps to its share: later people get their first line only.
    const crowd: PraxisModule = {
      ...module,
      characters: module.characters.map((character) => (character.id === 'traveller' ? character : { ...character, appearance: 'Tall. '.repeat(80), personality: 'Quiet. '.repeat(80) })),
    };
    let save = startSave(crowd);
    for (const character of crowd.characters) save = must(placeCharacter(crowd, save, character.id, 'pc-landward-gate')).save;
    const crowded = contextPlan(crowd, must(say(crowd, save, 'look', 'I look around.')).save).messages[1]!.content;
    const looks = crowded.split('\n').filter((entry) => !entry.startsWith('[ You are') && entry.includes('Looks:'));
    expect(looks.length).toBeGreaterThan(0);
    expect(looks.length).toBeLessThan(crowd.characters.length - 1);
  });
});
