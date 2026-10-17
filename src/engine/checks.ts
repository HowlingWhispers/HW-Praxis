// Checks: the Four Approaches on Genesys dice, settled by the rules.
//
// A check is aimed at someone or something in the scene: a person, a thing, or the place
// itself. With a given approach it does one of three things:
//   - wears a state down by the net successes (Force on Health, Flair on Strain);
//   - builds a state up, for the states marked `grows` (Focus's Leverage and Prepared),
//     which then help a later check against the same target and are spent there;
//   - or is a deed: an act with no state behind it, which simply works or fails (Finesse
//     against a person: lift, slip past, plant).
// The approach that owns a state moves it normally; a secondary approach adds a setback die
// and pays the owner's costs on failure; an approach with no claim cannot move it. Failure
// and two or more threat cost what the module's approach table says. How hard it is comes
// from the target: its own difficulty, its tier, or the module's default. The model never
// decides any of this: it is told the outcome as one directive.
//
// Randomness is passed in. A player may also settle a check without rolling: it succeeds
// once, costs nothing, and the ledger records that the player decided.

import { playable } from './records';
import { DIFFICULTY_NAMES, stateDefFor, type Approach, type Cost, type Deed, type PraxisModule } from './module';
import { band, fact, labelFor, read, shortLabel, write, type StateDef, type StateTerminal, type StateValues } from './state';
import { definite, midSentence, toYou, wantedAsYou } from './words';
import { buildPool, oddsOf, rollPool, type Odds, type Pool } from './dice';
import { playerOf, thingsAt, type CheckRecord, type LedgerEntry, type Save } from './session';
import { pairName, relationshipBetween } from './relationships';
import { pairKey } from './state';

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

export type SubjectKind = 'person' | 'thing' | 'place';

// Someone or something a check can be aimed at: the people here, the things here, the place.
export interface Subject {
  id: string;
  name: string;
  kind: SubjectKind;
  local: boolean;
}

export function subjectsHere(module: PraxisModule, save: Save): Subject[] {
  const world = playable(module, save.local);
  const playerId = playerOf(world);
  const placeId = save.positions[playerId];
  const place = world.world.places.find((entry) => entry.id === placeId);
  const local = (entry: object) => (entry as { origin?: unknown }).origin === 'local';
  return [
    ...world.characters.filter((person) => person.id !== playerId && save.positions[person.id] === placeId).map((person) => ({ id: person.id, name: person.name, kind: 'person' as const, local: local(person) })),
    ...(placeId ? thingsAt(world, save, placeId) : []).map((thing) => ({ id: thing.id, name: thing.name, kind: 'thing' as const, local: local(thing) })),
    ...(place ? [{ id: place.id, name: place.name, kind: 'place' as const, local: local(place) }] : []),
  ];
}

// Which states belong on which kind of target.
export function fitsSubject(def: StateDef, kind: SubjectKind): boolean {
  if (kind === 'person') return def.scope === 'char' || def.scope === 'npc';
  if (kind === 'thing') return def.scope === 'item';
  return def.scope === 'place';
}

const actable = (def: StateDef) => Boolean(def.approach) && def.bands.length > 0 && def.display !== 'hidden';

// How hard it is to act on a target with an approach, from Simple (0) to Formidable (5): the
// target's own difficulty for that approach or for all, a random one fixed by the save's
// seed, its tier, or the module's default.
export function difficultyFor(module: PraxisModule, save: Save, ownerId: string, approachId: string): number {
  const world = playable(module, save.local);
  const person = world.characters.find((entry) => entry.id === ownerId);
  const record = person ?? world.items.find((entry) => entry.id === ownerId) ?? world.world.places.find((entry) => entry.id === ownerId);
  const set = record?.difficulty?.[approachId] ?? record?.difficulty?.all;
  if (typeof set === 'number') return Math.max(0, Math.min(5, set));
  if (set === 'random') return randomDifficulty(save.seed ?? 0, ownerId, approachId);
  const tier = person?.tier ? world.ruleset.tiers?.[person.tier] : undefined;
  if (tier) return tier.difficulty;
  return world.ruleset.dice?.difficulty ?? 2;
}

// Easy to Daunting, most often Average, the same every time for one save, target and approach.
export function randomDifficulty(seed: number, ownerId: string, approachId: string): number {
  let hash = 2166136261 ^ seed;
  for (const char of `${ownerId}:${approachId}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return [1, 2, 2, 2, 3, 3, 4][(hash >>> 0) % 7]!;
}

// One thing an approach can do to a target.
export type Act =
  | { kind: 'state'; def: StateDef; claim: Exclude<Claim, 'none'>; value: number; word: string }
  | { kind: 'deed'; deed: Deed };

export interface ApproachActs {
  approach: Approach;
  acts: Act[];
  difficulty: number;
}

// For each approach, what it can do to this target: the states it owns, then those it can
// reach as a secondary, then any deed. An empty list is no claim.
export function actsOn(module: PraxisModule, save: Save, subject: Subject): ApproachActs[] {
  const world = playable(module, save.local);
  return world.ruleset.approaches.map((approach) => {
    const states: Act[] = [];
    for (const base of world.ruleset.states) {
      if (!actable(base) || !fitsSubject(base, subject.kind)) continue;
      const def = stateDefFor(world, base.id, subject.id) ?? base;
      const claim = claimOf(def, approach.id);
      if (claim === 'none') continue;
      const value = read(save.values, def, subject.id);
      states.push({ kind: 'state', def, claim, value, word: shortLabel(def, labelFor(def, value, false)) });
    }
    states.sort((a, b) => (a.kind === 'state' && b.kind === 'state' ? (a.claim === b.claim ? 0 : a.claim === 'owner' ? -1 : 1) : 0));
    const deeds: Act[] = world.ruleset.deeds.filter((deed) => deed.kind === subject.kind && deed.approach === approach.id).map((deed) => ({ kind: 'deed', deed }));
    return { approach, acts: [...states, ...deeds], difficulty: difficultyFor(world, save, subject.id, approach.id) };
  });
}

// A check's aim: a target, and the state to move, or null for a deed.
export interface Target {
  owner: string;
  defId: string | null;
}

export interface TargetInfo {
  owner: string;
  ownerName: string;
  kind: SubjectKind;
  // The state moved, or null for a deed.
  def: StateDef | null;
  deed: Deed | null;
  value: number;
  word: string;
}

// Every state a check could move here, on every target. Kept for the guide and tests.
export function targetsHere(module: PraxisModule, save: Save): (TargetInfo & { def: StateDef; defId: string })[] {
  const world = playable(module, save.local);
  return subjectsHere(world, save).flatMap((subject) => world.ruleset.states
    .filter((base) => actable(base) && fitsSubject(base, subject.kind))
    .map((base) => {
      const def = stateDefFor(world, base.id, subject.id) ?? base;
      const value = read(save.values, def, subject.id);
      return { owner: subject.id, ownerName: subject.name, kind: subject.kind, def, defId: def.id, deed: null, value, word: shortLabel(def, labelFor(def, value, false)) };
    }));
}

export interface CheckChoice {
  approach: string;
  // 0 for none.
  charge: number;
  // Reuse a spent charge at the module's push cost.
  push?: boolean;
  // Spend the player's Story Point to upgrade a die.
  storyPoint?: boolean;
  // Spend what Focus built against this target (Leverage, Prepared). On unless turned off.
  useAids?: boolean;
  // What the player wants from it, in their own words: "She lets me through without
  // signing." A success makes it happen, a partial success leaves it not yet won, a failure
  // denies it. The narrator is told so plainly.
  intent?: string;
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
  // The difficulty before and after what helps, and its name on the Genesys ladder.
  difficulty: { base: number; final: number; name: string };
  stakes: { success: string; failure: string[]; threat: string[] };
  uses: { edge: boolean; storyPoint: boolean; rulesStoryPoint: boolean; push: boolean; aids: { defId: string; value: number }[] };
  // What Focus has built against this target, whether or not this check spends it.
  aids: { def: StateDef; value: number }[];
}

export type PlanResult = CheckPlan | { ok: false; reason: string };

function ownerName(world: PraxisModule, owner: string): string {
  if (owner.includes('|')) return pairName(world, owner, playerOf(world)).replace(/^the /, 'The ');
  return world.characters.find((entry) => entry.id === owner)?.name
    ?? world.items.find((entry) => entry.id === owner)?.name
    ?? world.world.places.find((entry) => entry.id === owner)?.name
    ?? owner;
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
  const subject = subjectsHere(world, save).find((entry) => entry.id === target.owner);
  if (!subject) return { ok: false, reason: 'That is not here.' };
  const approach = world.ruleset.approaches.find((entry) => entry.id === choice.approach);
  if (!approach) return { ok: false, reason: 'There is no such approach.' };
  let info: TargetInfo;
  let claim: Claim;
  if (target.defId) {
    const def = stateDefFor(world, target.defId, subject.id);
    if (!def || !actable(def) || !fitsSubject(def, subject.kind)) return { ok: false, reason: 'That is not something a check can move here.' };
    claim = claimOf(def, approach.id);
    if (claim === 'none') return { ok: false, reason: `${approach.name} cannot move ${def.name}.` };
    const value = read(save.values, def, subject.id);
    info = { owner: subject.id, ownerName: subject.name, kind: subject.kind, def, deed: null, value, word: shortLabel(def, labelFor(def, value, false)) };
  } else {
    const deed = world.ruleset.deeds.find((entry) => entry.kind === subject.kind && entry.approach === approach.id);
    if (!deed) return { ok: false, reason: `${approach.name} has nothing to do to ${inSentence(subject.name)} on its own.` };
    claim = 'owner';
    info = { owner: subject.id, ownerName: subject.name, kind: subject.kind, def: null, deed, value: 0, word: '' };
  }
  const paying = claim === 'owner' ? approach : world.ruleset.approaches.find((entry) => entry.id === info.def?.approach?.owner) ?? approach;

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
  // What Focus built against this target helps any other approach, and is spent on it.
  const base = difficultyFor(world, save, subject.id, approach.id);
  let difficulty = base;
  let boost = useEdge ? 1 : 0;
  const aids = world.ruleset.states
    .filter((def) => def.aids && fitsSubject(def, subject.kind))
    .map((def) => ({ def, value: read(save.values, def, subject.id) }))
    .filter((entry) => entry.value > 0);
  const usable = choice.useAids === false ? [] : aids.filter((entry) => entry.def.approach?.owner !== approach.id);
  for (const { def, value } of usable) {
    if (def.aids === 'easier') {
      const steps = Math.min(value, difficulty);
      difficulty -= steps;
      reasons.push(`Your ${def.name}: ${steps === 1 ? 'one step' : `${steps} steps`} easier`);
    } else {
      boost += value;
      reasons.push(`${def.name}: ${value === 1 ? 'one boost die' : `${value} boost dice`}`);
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
    boost,
    difficulty,
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
    difficulty: { base, final: difficulty, name: DIFFICULTY_NAMES[difficulty] ?? 'Average' },
    stakes: {
      success: !info.def
        ? 'What you are trying works.'
        : info.def.grows
          ? `Your ${info.def.name} against ${inSentence(info.ownerName)} rises by one, and one more for each extra success. It helps a later check against them by another approach.`
          : `${info.ownerName}’s ${info.def.name} drops by one, and one more for each extra success.`,
      failure: costLines(world, save, paying.failure, paying.failureMinutes, info.owner),
      threat: costLines(world, save, paying.threat, paying.threatMinutes, info.owner),
    },
    uses: { edge: useEdge, storyPoint: spendStoryPoint, rulesStoryPoint, push, aids: usable.map((entry) => ({ defId: entry.def.id, value: entry.value })) },
    aids,
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
  const terminals: { owner: string; defId: string; terminal: StateTerminal }[] = [];
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
    if (result.terminal) terminals.push({ owner, defId: def.id, terminal: result.terminal });
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

  const def = plan.target.def;
  if (auto) {
    if (def) change(def.id, target.owner, (current) => current + (def.grows ? 1 : -1), 'player');
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
    for (const aid of plan.uses.aids) change(aid.defId, target.owner, () => 0);

    const roll = rollPool(plan.pool, random!);
    good = roll.good;
    bad = roll.bad;
    reading = roll.reading;

    if (reading.succeeded) {
      const amount = reading.netSuccess + (reading.triumph ? 1 : 0);
      if (def) change(def.id, target.owner, (current) => current + (def.grows ? amount : -amount));
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

    // A triumph or a despair against someone moves the bond between you a tier, when this
    // approach owns the bond (Four Approaches: Flair).
    const swing = (reading.triumph ? 1 : 0) - (reading.despair ? 1 : 0);
    const relationship = swing ? relationshipBetween(world, playerId, target.owner) : undefined;
    if (relationship?.bondStateId) {
      const bondOwner = pairKey(...relationship.personIds);
      const bondDef = stateDefFor(world, relationship.bondStateId, bondOwner);
      if (bondDef && claimOf(bondDef, plan.approach.id) === 'owner') change(bondDef.id, bondOwner, (current) => current + swing);
    }
  }

  // The outcome, as facts in the story's own terms. The narrator is told to show it; each
  // condition says what it means, including when more is needed before it is over.
  const named = (owner: string) => (owner === playerId ? 'You' : definite(ownerName(world, owner)));
  const mid = (owner: string) => midSentence(named(owner));
  const isPerson = (owner: string) => owner !== playerId && world.characters.some((character) => character.id === owner);
  // What shows about one state now. When it has just reached an end: for someone else with
  // words of their own (npcLabels), those words say it all; otherwise the terminal's note
  // follows, turned to "you" for the player.
  const shows = (stateDef: StateDef, owner: string, evenAtRest = false): string => {
    const forPlayer = owner === playerId;
    const said = fact(stateDef, named(owner), read(values, stateDef, owner), forPlayer, evenAtRest);
    const reached = terminals.find((entry) => entry.owner === owner && entry.defId === stateDef.id)?.terminal;
    const means = !reached ? '' : forPlayer ? reached.playerNote ?? toYou(reached.note) : stateDef.npcLabels ? '' : reached.note;
    return [said, means].filter(Boolean).join(' ');
  };
  const them = mid(target.owner);
  const reachedEnd = Boolean(def && terminals.some((entry) => entry.owner === target.owner && entry.defId === def.id));
  // What the player wanted, when they said: the outcome says outright whether it happens.
  const wanted = wantedAsYou(choice.intent ?? '');
  const parts: string[] = [];
  if (reading.succeeded) {
    const better = reading.triumph ? ', better than hoped' : '';
    const works = wanted ? `It works${better}, so this happens: ${wanted}.` : `It works${better}.`;
    if (!def) parts.push(works);
    else if (def.grows) parts.push(wanted ? works : `It works${better}: you notice something useful about ${them}.`, shows(def, target.owner));
    else if (reachedEnd) parts.push(works, shows(def, target.owner));
    else {
      const now = shows(def, target.owner);
      const notYet = wanted ? ` This does not happen yet: ${wanted}.` : '';
      if (now) parts.push(`It gains ground${better}, but it is not over yet.${notYet}`, now);
      else parts.push(isPerson(target.owner) ? `It lands, but only just: ${them} shows no sign of it yet.${notYet}` : `It lands, but only just.${notYet}`, isPerson(target.owner) ? '' : shows(def, target.owner, true));
    }
  } else {
    const worse = reading.despair ? ', and it goes badly wrong' : '';
    const denied = wanted ? ` This does not happen: ${wanted}.` : '';
    parts.push((def?.grows ? `It fails${worse}: you learn nothing useful about ${them}.` : def ? `It fails${worse}: it makes no headway against ${them}.` : `It fails${worse}.`) + denied);
  }
  if (reading.succeeded && reading.despair) parts.push('Something else goes badly wrong.');
  if (!reading.succeeded && reading.triumph) parts.push('Even so, something goes very well for you.');
  if (reading.netAdvantage === 1) parts.push('Something small also goes your way.');
  else if (reading.netAdvantage >= 2) parts.push('Something else goes your way too: an opening you can use.');
  else if (reading.netAdvantage === -1) parts.push('Something small also goes against you.');
  else if (reading.netAdvantage <= -2) parts.push('Something else goes wrong for you too.');
  // What else it changed: the price of failing, a bond that moved.
  for (const { owner, def: changedDef } of changed.values()) {
    if (owner === target.owner && changedDef.id === target.defId) continue;
    if (plan.uses.aids.some((aid) => aid.defId === changedDef.id) && owner === target.owner) continue;
    if (dice.momentum === changedDef.id || dice.edge === changedDef.id || dice.storyPoints === changedDef.id) continue;
    const said = shows(changedDef, owner);
    if (said) parts.push(said);
  }
  if (clock !== save.clock && !reading.succeeded) parts.push('It takes time.');

  const record: CheckRecord = {
    approach: plan.approach.id,
    approachName: plan.approach.name,
    target: { owner: target.owner, defId: def?.id ?? null, label: `${plan.target.ownerName} · ${def ? def.name : plan.target.deed?.label ?? 'a deed'}` },
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
    ...(choice.intent?.trim() ? { intent: choice.intent.trim().slice(0, 300) } : {}),
  };

  return {
    ok: true,
    outcome: {
      save: { ...save, values, clock, spent, ledger: [...save.ledger, ...entries] },
      entries,
      terminals: terminals.map((entry) => entry.terminal),
      record,
      directive: parts.filter(Boolean).join(' '),
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
