// Checks: the Four Approaches on Genesys dice, settled by the rules.
//
// A check moves one state on one owner (someone's Strain, a place's Alert) down by the net
// successes. The approach that owns the state moves it normally; a secondary approach adds a
// setback die and pays the owner's costs on failure; an approach with no claim cannot move
// it. Failure and two or more threat cost what the module's approach table says. The model
// never decides any of this: it is told the outcome as one directive.
//
// Randomness is passed in. A player may also settle a check without rolling: it succeeds
// once, costs nothing, and the ledger records that the player decided.

import { playable } from './records';
import { stateDefFor, type Approach, type Cost, type PraxisModule } from './module';
import { band, line, read, write, type StateDef, type StateTerminal, type StateValues } from './state';
import { buildPool, oddsOf, rollPool, type Odds, type Pool } from './dice';
import { playerOf, type CheckRecord, type LedgerEntry, type Save } from './session';

const inSentence = (name: string) => (name.startsWith('The ') ? `the ${name.slice(4)}` : name);

export type Claim = 'owner' | 'secondary' | 'none';

export function claimOf(def: StateDef, approachId: string): Claim {
  if (!def.approach) return 'none';
  if (def.approach.owner === approachId) return 'owner';
  return def.approach.secondary.includes(approachId) ? 'secondary' : 'none';
}

export const CHARGE_SLOTS: Record<'trained' | 'practiced' | 'raw', readonly number[]> = {
  trained: [1, 2, 3],
  practiced: [1, 2],
  raw: [1],
};

export interface ChargeSlots {
  approach: string;
  training: 'trained' | 'practiced' | 'raw' | null;
  slots: { value: number; spent: boolean }[];
}

export function chargesOf(module: PraxisModule, save: Save, characterId: string): ChargeSlots[] {
  const world = playable(module, save.local);
  const character = world.characters.find((entry) => entry.id === characterId);
  return world.ruleset.approaches.map((approach) => {
    const training = character?.charges[approach.id] ?? null;
    const spent = save.spent[characterId]?.[approach.id] ?? [];
    const slots = training ? CHARGE_SLOTS[training].map((value) => ({ value, spent: spent.includes(value) })) : [];
    return { approach: approach.id, training, slots };
  });
}

export interface Target {
  owner: string;
  defId: string;
}

export interface TargetInfo extends Target {
  ownerName: string;
  def: StateDef;
  value: number;
  word: string;
}

// Every state a check could wear down here: banded states with an owning approach, on the
// people present and on the place itself.
export function targetsHere(module: PraxisModule, save: Save): TargetInfo[] {
  const world = playable(module, save.local);
  const playerId = playerOf(world);
  const placeId = save.positions[playerId];
  const place = world.world.places.find((entry) => entry.id === placeId);
  const out: TargetInfo[] = [];
  const add = (owner: string, ownerName: string, kind: 'person' | 'place') => {
    for (const base of world.ruleset.states) {
      if (!base.approach || !base.bands.length || base.display === 'hidden') continue;
      if (kind === 'place' ? base.scope !== 'place' : !(base.scope === 'char' || base.scope === 'npc')) continue;
      const def = stateDefFor(world, base.id, owner) ?? base;
      const value = read(save.values, def, owner);
      out.push({ owner, defId: def.id, ownerName, def, value, word: band(def, value).label });
    }
  };
  for (const person of world.characters) {
    if (person.id !== playerId && save.positions[person.id] === placeId) add(person.id, person.name, 'person');
  }
  if (place) add(place.id, place.name, 'place');
  return out;
}

export interface CheckChoice {
  approach: string;
  // 0 for none.
  charge: number;
  // Reuse a spent charge at the module's push cost.
  push?: boolean;
  // Spend the player's Story Point to upgrade a die.
  storyPoint?: boolean;
}

export interface CheckPlan {
  ok: true;
  target: TargetInfo;
  approach: Approach;
  rating: number;
  claim: Claim;
  // Whose costs a failure pays: the approach itself, or the owner when used as a secondary.
  paying: Approach;
  pool: Pool;
  odds: Odds;
  // Why each die beyond the approach and charge is there.
  reasons: string[];
  stakes: { success: string; failure: string[]; threat: string[] };
  uses: { edge: boolean; storyPoint: boolean; rulesStoryPoint: boolean; push: boolean };
}

export type PlanResult = CheckPlan | { ok: false; reason: string };

function ownerName(world: PraxisModule, owner: string): string {
  return world.characters.find((entry) => entry.id === owner)?.name ?? world.world.places.find((entry) => entry.id === owner)?.name ?? owner;
}

function describeCost(world: PraxisModule, save: Save, cost: Cost, targetOwner: string, times: number): string {
  const playerId = playerOf(world);
  const owner = cost.who === 'player' ? playerId : cost.who === 'place' ? save.positions[playerId] ?? '' : targetOwner;
  const def = stateDefFor(world, cost.stateId, owner);
  const amount = Math.abs(cost.add * times);
  const name = def?.name ?? cost.stateId;
  if (cost.who === 'player') return `You ${cost.add < 0 ? 'lose' : 'gain'} ${amount} ${name}`;
  return `${name} ${cost.add < 0 ? '−' : '+'}${amount} for ${inSentence(ownerName(world, owner))}`;
}

function costLines(world: PraxisModule, save: Save, costs: readonly Cost[], minutes: number, targetOwner: string, times = 1): string[] {
  const out = costs.map((cost) => describeCost(world, save, cost, targetOwner, times));
  if (minutes) out.push(`${minutes * times} minutes pass`);
  return out;
}

export function planCheck(module: PraxisModule, save: Save, target: Target, choice: CheckChoice): PlanResult {
  const world = playable(module, save.local);
  const playerId = playerOf(world);
  const info = targetsHere(world, save).find((entry) => entry.owner === target.owner && entry.defId === target.defId);
  if (!info) return { ok: false, reason: 'That is not something a check can move here.' };
  const approach = world.ruleset.approaches.find((entry) => entry.id === choice.approach);
  if (!approach) return { ok: false, reason: 'There is no such approach.' };
  const claim = claimOf(info.def, approach.id);
  if (claim === 'none') return { ok: false, reason: `${approach.name} cannot move ${info.def.name}.` };
  const paying = claim === 'owner' ? approach : world.ruleset.approaches.find((entry) => entry.id === info.def.approach?.owner) ?? approach;

  const ratingDef = stateDefFor(world, approach.id, playerId);
  const rating = ratingDef ? read(save.values, ratingDef, playerId) : 0;
  const dice = world.ruleset.dice ?? { difficulty: 2, setbacks: [] };
  const reasons: string[] = [];

  const charge = Math.max(0, Math.round(choice.charge));
  let push = false;
  if (charge > 0) {
    const slots = chargesOf(world, save, playerId).find((entry) => entry.approach === approach.id)?.slots ?? [];
    const slot = slots.find((entry) => entry.value === charge);
    if (!slot) return { ok: false, reason: `There is no +${charge} charge on ${approach.name}.` };
    if (slot.spent) {
      if (!choice.push || !dice.push) return { ok: false, reason: `The +${charge} charge is spent. Push to use it again.` };
      push = true;
    }
  }

  const readPlayer = (stateId: string | undefined) => {
    if (!stateId) return null;
    const def = stateDefFor(world, stateId, playerId);
    return def ? { def, value: read(save.values, def, playerId) } : null;
  };
  const storyPoints = readPlayer(dice.storyPoints);
  const edge = readPlayer(dice.edge);
  const spendStoryPoint = Boolean(choice.storyPoint);
  if (spendStoryPoint && (!storyPoints || storyPoints.value < 1)) return { ok: false, reason: 'You have no Story Point to spend.' };
  // The rules spend theirs when they hold them all.
  const rulesStoryPoint = Boolean(storyPoints && storyPoints.value <= Math.min(storyPoints.def.min, storyPoints.def.max) && !spendStoryPoint);
  const useEdge = Boolean(edge && edge.value > 0);

  let setback = 0;
  if (claim === 'secondary') { setback += 1; reasons.push(`${approach.name} is off its home ground: one setback die`); }
  const placeId = save.positions[playerId] ?? '';
  for (const rule of dice.setbacks) {
    if (rule.approaches.length && !rule.approaches.includes(approach.id)) continue;
    const owner = rule.who === 'player' ? playerId : placeId;
    const def = stateDefFor(world, rule.stateId, owner);
    if (!def) continue;
    const value = read(save.values, def, owner);
    if ((rule.atLeast === undefined || value >= rule.atLeast) && (rule.atMost === undefined || value <= rule.atMost)) {
      setback += 1;
      reasons.push(`${rule.reason}: one setback die`);
    }
  }
  if (useEdge) reasons.push('Edge: one boost die');
  if (spendStoryPoint) reasons.push('Your Story Point: one die upgraded');
  if (rulesStoryPoint) reasons.push('The rules spend their Story Point: one difficulty die upgraded');
  if (push && dice.push) reasons.push(`Pushing: ${describeCost(world, save, { stateId: dice.push.stateId, who: 'player', add: dice.push.add }, info.owner, 1).replace(/^You /, 'you ')}`);

  const pool = buildPool({
    rating,
    charge,
    upgrades: spendStoryPoint ? 1 : 0,
    boost: useEdge ? 1 : 0,
    difficulty: dice.difficulty,
    difficultyUpgrades: rulesStoryPoint ? 1 : 0,
    setback,
  });

  return {
    ok: true,
    target: info,
    approach,
    rating,
    claim,
    paying,
    pool,
    odds: oddsOf(pool),
    reasons,
    stakes: {
      success: `${info.ownerName}’s ${info.def.name} drops by one, and one more for each extra success.`,
      failure: costLines(world, save, paying.failure, paying.failureMinutes, info.owner),
      threat: costLines(world, save, paying.threat, paying.threatMinutes, info.owner),
    },
    uses: { edge: useEdge, storyPoint: spendStoryPoint, rulesStoryPoint, push },
  };
}

export interface CheckOutcome {
  save: Save;
  entries: LedgerEntry[];
  terminals: StateTerminal[];
  record: CheckRecord;
  directive: string;
}

// Settles a check: rolls (or, with `random` null, succeeds by the player's choice), writes
// every change, and returns the directive for the narrator. Opening the turn is turns.ts's job.
export function settleCheck(module: PraxisModule, save: Save, target: Target, choice: CheckChoice, random: (() => number) | null): { ok: true; outcome: CheckOutcome } | { ok: false; reason: string } {
  const world = playable(module, save.local);
  const auto = random === null;
  const plan = planCheck(world, save, target, auto ? { approach: choice.approach, charge: 0 } : choice);
  if (!plan.ok) return plan;
  const playerId = playerOf(world);
  const placeId = save.positions[playerId] ?? '';
  const dice = world.ruleset.dice ?? { difficulty: 2, setbacks: [] };

  let values: StateValues = save.values;
  let clock = save.clock;
  const entries: LedgerEntry[] = [];
  const terminals: { owner: string; terminal: StateTerminal }[] = [];
  const changed = new Map<string, { owner: string; def: StateDef }>();

  const change = (stateId: string, owner: string, next: (current: number, def: StateDef) => number, source: 'rule' | 'player' = 'rule') => {
    const def = stateDefFor(world, stateId, owner);
    if (!def || !owner) return;
    const result = write(values, def, owner, next(read(values, def, owner), def), source);
    values = result.values;
    if (result.change) {
      entries.push({ kind: 'state', at: clock, ...result.change });
      changed.set(`${owner}:${stateId}`, { owner, def });
    }
    if (result.terminal) terminals.push({ owner, terminal: result.terminal });
  };
  const pay = (costs: readonly Cost[], minutes: number, times: number) => {
    for (const cost of costs) {
      const owner = cost.who === 'player' ? playerId : cost.who === 'place' ? placeId : target.owner;
      change(cost.stateId, owner, (current) => current + cost.add * times);
    }
    if (minutes) {
      const to = clock + minutes * times;
      entries.push({ kind: 'clock', at: clock, from: clock, to, source: 'rule', reason: 'check' });
      clock = to;
    }
  };

  let spent = save.spent;
  let good: CheckRecord['good'] = [];
  let bad: CheckRecord['bad'] = [];
  let reading = { netSuccess: 1, netAdvantage: 0, succeeded: true, triumph: false, despair: false };

  if (auto) {
    change(target.defId, target.owner, (current) => current - 1, 'player');
  } else {
    // What the roll uses up.
    if (plan.uses.push && dice.push) change(dice.push.stateId, playerId, (current) => current + dice.push!.add);
    if (choice.charge > 0 && !plan.uses.push) {
      const slots = chargesOf(world, save, playerId).find((entry) => entry.approach === plan.approach.id)?.slots ?? [];
      const nowSpent = [...(save.spent[playerId]?.[plan.approach.id] ?? []), choice.charge];
      const allSpent = slots.every((slot) => nowSpent.includes(slot.value));
      spent = { ...spent, [playerId]: { ...(spent[playerId] ?? {}), [plan.approach.id]: allSpent ? [] : nowSpent } };
    }
    if (plan.uses.edge && dice.edge) change(dice.edge, playerId, () => 0);
    if (plan.uses.storyPoint && dice.storyPoints) change(dice.storyPoints, playerId, (current) => current - 1);

    const roll = rollPool(plan.pool, random!);
    good = roll.good;
    bad = roll.bad;
    reading = roll.reading;

    if (reading.succeeded) {
      change(target.defId, target.owner, (current) => current - reading.netSuccess - (reading.triumph ? 1 : 0));
    } else {
      pay(plan.paying.failure, plan.paying.failureMinutes, reading.despair ? 2 : 1);
    }
    if (reading.netAdvantage >= 2 && dice.edge) change(dice.edge, playerId, () => 1);
    if (reading.netAdvantage <= -2) pay(plan.paying.threat, plan.paying.threatMinutes, 1);
    if (plan.uses.rulesStoryPoint && dice.storyPoints) change(dice.storyPoints, playerId, (current) => current + 1);

    // Momentum: at either end, a Story Point changes sides.
    if (dice.momentum) {
      const momentumDef = stateDefFor(world, dice.momentum, playerId);
      if (momentumDef) {
        const next = read(values, momentumDef, playerId) + (reading.succeeded ? 1 : -1);
        if (next >= 3) {
          change(dice.momentum, playerId, () => 0);
          if (dice.storyPoints) change(dice.storyPoints, playerId, (current) => current - 1);
        } else if (next <= -3) {
          change(dice.momentum, playerId, () => 0);
          if (dice.storyPoints) change(dice.storyPoints, playerId, (current) => current + 1);
        } else {
          change(dice.momentum, playerId, () => next);
        }
      }
    }
  }

  // The directive: what happened, as facts the narrator must show.
  const name = (owner: string) => ownerName(world, owner);
  const parts: string[] = [];
  const targetTerminal = terminals.find((entry) => entry.owner === target.owner);
  if (reading.succeeded) {
    parts.push(`${plan.approach.name} succeeds${reading.triumph ? ', better than hoped' : ''}.`);
    if (targetTerminal) parts.push(`${name(target.owner)}: ${targetTerminal.terminal.note}`);
    else {
      const fact = line(plan.target.def, name(target.owner), read(values, plan.target.def, target.owner));
      parts.push(fact ? fact.replace(/^\[|\]$/g, '') : `It tells on ${inSentence(name(target.owner))}, though it does not show yet.`);
    }
  } else {
    parts.push(`${plan.approach.name} fails${reading.despair ? ', and it goes badly wrong' : ''}.`);
  }
  for (const { owner, def } of changed.values()) {
    if (owner === target.owner && def.id === target.defId) continue;
    if (dice.momentum === def.id || dice.edge === def.id || dice.storyPoints === def.id) continue;
    const terminal = terminals.find((entry) => entry.owner === owner && entry.terminal);
    if (terminal && owner !== target.owner) { parts.push(`${name(owner)}: ${terminal.terminal.note}`); continue; }
    const fact = line(def, name(owner), read(values, def, owner));
    if (fact) parts.push(fact.replace(/^\[|\]$/g, ''));
  }
  if (clock !== save.clock && !reading.succeeded) parts.push('It takes time.');
  if (reading.netAdvantage === 1) parts.push('It leaves a small opening.');
  else if (reading.netAdvantage >= 2) parts.push('It leaves a clear opening.');
  else if (reading.netAdvantage === -1) parts.push('It brings a small complication.');
  else if (reading.netAdvantage <= -2) parts.push('It brings real trouble.');

  const record: CheckRecord = {
    approach: plan.approach.id,
    approachName: plan.approach.name,
    target: { owner: target.owner, defId: target.defId, label: `${plan.target.ownerName} · ${plan.target.def.name}` },
    charge: auto ? 0 : Math.max(0, Math.round(choice.charge)),
    push: !auto && plan.uses.push,
    storyPoint: !auto && plan.uses.storyPoint,
    auto,
    good,
    bad,
    netSuccess: reading.netSuccess,
    netAdvantage: reading.netAdvantage,
    succeeded: reading.succeeded,
    triumph: reading.triumph,
    despair: reading.despair,
    chance: Math.round(plan.odds.success * 1000) / 1000,
  };

  return {
    ok: true,
    outcome: {
      save: { ...save, values, clock, spent, ledger: [...save.ledger, ...entries] },
      entries,
      terminals: terminals.map((entry) => entry.terminal),
      record,
      directive: parts.join(' '),
    },
  };
}

// A full rest: the module's rest effects and fresh charges, after a long enough wait.
export function restEffects(module: PraxisModule, save: Save): { save: Save; entries: LedgerEntry[] } {
  const world = playable(module, save.local);
  const rest = world.ruleset.rest;
  if (!rest) return { save, entries: [] };
  const playerId = playerOf(world);
  let values = save.values;
  const entries: LedgerEntry[] = [];
  for (const effect of rest.effects) {
    const def = stateDefFor(world, effect.stateId, playerId);
    if (!def) continue;
    const current = read(values, def, playerId);
    const next = effect.toMax ? Math.max(def.min, def.max) : current + (effect.add ?? 0);
    const result = write(values, def, playerId, next, 'rule');
    values = result.values;
    if (result.change) entries.push({ kind: 'state', at: save.clock, ...result.change });
  }
  const spent = rest.resetCharges ? { ...save.spent, [playerId]: {} } : save.spent;
  return { save: { ...save, values, spent, ledger: [...save.ledger, ...entries] }, entries };
}
