import { describe, expect, it } from 'vitest';
import {
  act, buildPool, chargesOf, oddsOf, parseSave, planCheck, read, readRoll, rollPool, setState, settleCheck, startSave, stateDefFor,
  tallyFaces, targetsHere, undoLastTurn, type Save,
} from '../src/engine';
import { abernys } from './abernys';

const module = abernys();
const arbiterStrain = { owner: 'gate-arbiter', defId: 'strain' };
const always = (value: number) => () => value;

function must<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error((result as unknown as { reason: string }).reason);
  return result as Extract<T, { ok: true }>;
}

function value(save: Save, defId: string, owner: string): number {
  return read(save.values, stateDefFor(module, defId, owner)!, owner);
}

describe('the dice', () => {
  it('build a pool from rating and charge, as Genesys does with a skill', () => {
    expect(buildPool({ rating: 3, charge: 2, upgrades: 0, boost: 0, difficulty: 2, difficultyUpgrades: 0, setback: 0 }))
      .toEqual({ good: ['proficiency', 'proficiency', 'ability'], bad: ['difficulty', 'difficulty'] });
    expect(buildPool({ rating: 1, charge: 3, upgrades: 0, boost: 1, difficulty: 2, difficultyUpgrades: 1, setback: 1 }))
      .toEqual({ good: ['proficiency', 'ability', 'ability', 'boost'], bad: ['challenge', 'difficulty', 'setback'] });
    // An upgrade with no ability die left adds one.
    expect(buildPool({ rating: 2, charge: 2, upgrades: 1, boost: 0, difficulty: 0, difficultyUpgrades: 0, setback: 0 }).good)
      .toEqual(['proficiency', 'proficiency', 'ability']);
  });

  it('give exact odds', () => {
    const odds = oddsOf(buildPool({ rating: 3, charge: 2, upgrades: 0, boost: 0, difficulty: 2, difficultyUpgrades: 0, setback: 0 }));
    expect(Math.round(odds.success * 100)).toBe(70);
    expect(Math.round(odds.extra * 100)).toBe(45);
    expect(Math.round(oddsOf(buildPool({ rating: 2, charge: 0, upgrades: 0, boost: 0, difficulty: 2, difficultyUpgrades: 0, setback: 1 })).success * 100)).toBe(35);
  });

  it('read a roll: triumph counts as a success, despair as a failure', () => {
    expect(readRoll(tallyFaces(['R', 'FT', 'D']))).toMatchObject({ netSuccess: -1, netAdvantage: -1, succeeded: false, triumph: true, despair: true });
    const roll = rollPool({ good: ['proficiency'], bad: ['difficulty'] }, always(0.5));
    expect(roll.good[0]).toEqual({ kind: 'proficiency', face: 'SA' });
    expect(roll.reading).toMatchObject({ netSuccess: 1, netAdvantage: 0, succeeded: true });
  });
});

describe('checks', () => {
  it('know who may move what', () => {
    const start = startSave(module);
    expect(targetsHere(module, start).map((target) => `${target.owner}:${target.defId}`)).toEqual([
      'gate-arbiter:health', 'gate-arbiter:strain', 'gate-arbiter:leverage', 'gate-guard:health', 'gate-guard:strain', 'gate-guard:leverage',
      'pc-landward-gate:alert', 'pc-landward-gate:prepared-place',
    ]);
    const flair = must(planCheck(module, start, arbiterStrain, { approach: 'flair', charge: 2 }));
    expect(flair).toMatchObject({ claim: 'owner', rating: 3, pool: { good: ['proficiency', 'proficiency', 'ability'], bad: ['difficulty', 'difficulty'] } });
    expect(flair.stakes.failure).toEqual(['You lose 1 Strain']);
    const force = must(planCheck(module, start, arbiterStrain, { approach: 'force', charge: 0 }));
    expect(force.claim).toBe('secondary');
    expect(force.pool.bad).toEqual(['difficulty', 'difficulty', 'setback']);
    expect(force.paying.id).toBe('flair');
    expect(planCheck(module, start, arbiterStrain, { approach: 'finesse', charge: 0 })).toEqual({ ok: false, reason: 'Finesse cannot move Strain.' });
  });

  it('wear the target down on a success and record the dice', () => {
    const start = startSave(module);
    const { save, turn } = must(act(module, start, 't1', { type: 'check', target: arbiterStrain, choice: { approach: 'flair', charge: 2 }, input: 'Let me through on my word.', random: always(0.5) }));
    expect(value(save, 'strain', 'gate-arbiter')).toBe(2);
    expect(turn.check).toMatchObject({ approach: 'flair', charge: 2, succeeded: true, netSuccess: 2, netAdvantage: 1, auto: false });
    expect(turn.directive).toBe('Flair succeeds. What you just tried works on the gate Arbiter. The gate Arbiter is wavering. Something small also goes your way. Show it in this reply, and let it change what the gate Arbiter does from here on.');
    expect(save.spent.traveller?.flair).toEqual([2]);
    expect(value(save, 'momentum', 'traveller')).toBe(1);
    expect(chargesOf(module, save, 'traveller').find((entry) => entry.approach === 'flair')!.slots.map((slot) => slot.spent)).toEqual([false, true, false]);
    const undone = must(undoLastTurn(save)).save;
    expect(undone.spent).toEqual({});
  });

  it('cost the player on a failure, as the approach says', () => {
    const { save, turn } = must(act(module, startSave(module), 't1', { type: 'check', target: arbiterStrain, choice: { approach: 'flair', charge: 0 }, input: 'Please.', random: always(0) }));
    expect(turn.check?.succeeded).toBe(false);
    expect(value(save, 'strain', 'traveller')).toBe(5);
    expect(value(save, 'strain', 'gate-arbiter')).toBe(4);
    expect(turn.directive).toBe('Flair fails. What you just tried does not work on the gate Arbiter. Show it in this reply, and let the gate Arbiter react to it.');
    const force = must(act(module, startSave(module), 't1', { type: 'check', target: { owner: 'gate-guard', defId: 'health' }, choice: { approach: 'force', charge: 0 }, input: 'I swing.', random: always(0) })).save;
    expect(value(force, 'health', 'traveller')).toBe(7);
    expect(value(force, 'alert', 'pc-landward-gate')).toBe(1);
  });

  it('can be settled without rolling, recorded as the player\'s', () => {
    const { save, turn, entries } = must(act(module, startSave(module), 't1', { type: 'check', target: arbiterStrain, choice: { approach: 'flair', charge: 2 }, input: 'Let me through.', random: null }));
    expect(turn.check).toMatchObject({ auto: true, succeeded: true, good: [], charge: 0 });
    expect(entries).toEqual([{ kind: 'state', at: save.clock, defId: 'strain', owner: 'gate-arbiter', from: 4, to: 3, source: 'player' }]);
    expect(save.spent).toEqual({});
  });

  it('spend charges, push for Strain, and get them back when all are spent', () => {
    let save = startSave(module);
    const check = (charge: number, push = false) => must(settleCheck(module, save, arbiterStrain, { approach: 'flair', charge, push }, always(0))).outcome.save;
    save = check(2);
    expect(planCheck(module, save, arbiterStrain, { approach: 'flair', charge: 2 })).toEqual({ ok: false, reason: 'The +2 charge is spent. Push to use it again.' });
    const strainBefore = value(save, 'strain', 'traveller');
    save = check(2, true);
    expect(value(save, 'strain', 'traveller')).toBe(strainBefore - 2 - 1);
    save = check(1);
    save = check(3);
    expect(save.spent.traveller?.flair).toEqual([]);
  });

  it('use Edge and Story Points, and let the rules spend theirs', () => {
    let save = must(setState(module, startSave(module), 'edge', 'traveller', 1)).save;
    let plan = must(planCheck(module, save, arbiterStrain, { approach: 'flair', charge: 0, storyPoint: true }));
    expect(plan.pool.good).toEqual(['proficiency', 'ability', 'ability', 'boost']);
    save = must(settleCheck(module, save, arbiterStrain, { approach: 'flair', charge: 0, storyPoint: true }, always(0))).outcome.save;
    expect(value(save, 'edge', 'traveller')).toBe(0);
    expect(value(save, 'story-points', 'traveller')).toBe(0);
    plan = must(planCheck(module, save, arbiterStrain, { approach: 'flair', charge: 0 }));
    expect(plan.uses.rulesStoryPoint).toBe(true);
    expect(plan.pool.bad).toEqual(['challenge', 'difficulty']);
    save = must(settleCheck(module, save, arbiterStrain, { approach: 'flair', charge: 0 }, always(0))).outcome.save;
    expect(value(save, 'story-points', 'traveller')).toBe(1);
  });

  it('add setback dice for wounds and watchers', () => {
    let save = must(setState(module, startSave(module), 'health', 'traveller', 3)).save;
    save = must(setState(module, save, 'alert', 'pc-landward-gate', 2)).save;
    const plan = must(planCheck(module, save, { owner: 'pc-landward-gate', defId: 'alert' }, { approach: 'finesse', charge: 0 }));
    expect(plan.reasons).toEqual(['You are hurt: one setback die', 'Someone is watching: one setback die']);
  });

  it('come back after a full rest', () => {
    let save = must(act(module, startSave(module), 't1', { type: 'check', target: { owner: 'gate-guard', defId: 'health' }, choice: { approach: 'force', charge: 1 }, input: 'I swing.', random: always(0) })).save;
    expect(value(save, 'health', 'traveller')).toBe(7);
    const rested = must(act(module, save, 't2', { type: 'wait', minutes: 480 }));
    expect(rested.turn.input).toBe('I rest for 8 h.');
    expect(value(rested.save, 'health', 'traveller')).toBe(8);
    expect(rested.save.spent.traveller).toEqual({});
    save = rested.save;
    expect(parseSave(module, JSON.parse(JSON.stringify(save))).ok).toBe(true);
  });
});
