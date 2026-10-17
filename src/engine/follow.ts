// Followers: people who travel with you, such as a companion or a captive.
//
// Someone comes along only while one of the ruleset's follow rules holds for them (a bond
// with you at a warm enough tier, or a condition such as being down), or because the player
// set it by hand. Followers go where you go and keep no schedule. When you travel, each one's
// rule is checked again, and anyone it no longer holds for stays behind.

import { stateDefFor, type Character, type FollowRule, type PraxisModule } from './module';
import { band, read } from './state';
import { playable } from './records';
import { bondBetween } from './relationships';
import { playerOf, type ActionResult, type LedgerEntry, type Save } from './session';

export const BY_HAND = 'by-hand';

// The tier, as a band index, from which a bond kind's other person travels with you.
function followsFrom(bands: number, marked: number | undefined): number {
  return marked ?? Math.max(0, bands - 2);
}

function holds(world: PraxisModule, save: Save, rule: FollowRule, characterId: string): boolean {
  const playerId = playerOf(world);
  return rule.anyOf.some((condition) => {
    if ('bond' in condition) {
      const bond = bondBetween(world, save, playerId, characterId);
      if (!bond?.def || !bond.def.bands.length) return false;
      return band(bond.def, bond.value).index >= followsFrom(bond.def.bands.length, bond.def.followsFrom);
    }
    const def = stateDefFor(world, condition.stateId, characterId);
    if (!def) return false;
    const value = read(save.values, def, characterId);
    return (condition.atLeast === undefined || value >= condition.atLeast) && (condition.atMost === undefined || value <= condition.atMost);
  });
}

// The first follow rule that lets this person come with you, or null.
export function followRuleFor(module: PraxisModule, save: Save, characterId: string): FollowRule | null {
  const world = playable(module, save.local);
  if (characterId === playerOf(world)) return null;
  return world.ruleset.follow.find((rule) => holds(world, save, rule, characterId)) ?? null;
}

// How the narrator hears someone's place at your side: "your captive".
export function followingAs(module: PraxisModule, save: Save, characterId: string): string {
  const ruleId = save.following[characterId];
  if (!ruleId) return '';
  if (ruleId === BY_HAND) return 'travelling with you';
  return playable(module, save.local).ruleset.follow.find((rule) => rule.id === ruleId)?.as ?? 'travelling with you';
}

export function followersOf(module: PraxisModule, save: Save): Character[] {
  const world = playable(module, save.local);
  return world.characters.filter((character) => save.following[character.id]);
}

// Has someone who is here come with you: by a rule that holds, or by hand.
export function bringAlong(module: PraxisModule, save: Save, characterId: string, byHand = false): ActionResult {
  const world = playable(module, save.local);
  const playerId = playerOf(world);
  const person = world.characters.find((character) => character.id === characterId);
  if (!person || characterId === playerId) return { ok: false, reason: 'There is no one by that name.' };
  if (save.following[characterId]) return { ok: false, reason: `${person.name} is already with you.` };
  if (!save.positions[characterId] || save.positions[characterId] !== save.positions[playerId]) return { ok: false, reason: `${person.name} is not here.` };
  const rule = followRuleFor(world, save, characterId);
  if (!rule && !byHand) return { ok: false, reason: `Nothing makes ${person.name.replace(/^(The|A|An) /, (word) => word.toLowerCase())} come with you yet.` };
  const as = rule && !byHand ? rule.id : BY_HAND;
  const entry: LedgerEntry = { kind: 'follow', at: save.clock, characterId, as, source: byHand ? 'player' : 'rule' };
  return { ok: true, save: { ...save, following: { ...save.following, [characterId]: as }, ledger: [...save.ledger, entry] }, entries: [entry], terminals: [] };
}

export function leaveBehind(module: PraxisModule, save: Save, characterId: string): ActionResult {
  if (!save.following[characterId]) return { ok: false, reason: 'They are not with you.' };
  const following = { ...save.following };
  delete following[characterId];
  const entry: LedgerEntry = { kind: 'follow', at: save.clock, characterId, as: null, source: 'rule' };
  return { ok: true, save: { ...save, following, ledger: [...save.ledger, entry] }, entries: [entry], terminals: [] };
}

// Who comes with you on a journey from `from` to `to`, arriving at `at`: everyone following
// for whom a follow rule still holds (or who follows by hand), and who is with you when you
// set out. The rest stay where they are and stop following.
export function carryFollowers(module: PraxisModule, save: Save, from: string, to: string, at: number): {
  positions: Record<string, string>;
  following: Record<string, string>;
  entries: LedgerEntry[];
  came: Character[];
  stayed: Character[];
} {
  const world = playable(module, save.local);
  const positions: Record<string, string> = { ...save.positions };
  const following: Record<string, string> = { ...save.following };
  const entries: LedgerEntry[] = [];
  const came: Character[] = [];
  const stayed: Character[] = [];
  for (const person of world.characters) {
    const ruleId = following[person.id];
    if (!ruleId) continue;
    const withYou = positions[person.id] === from;
    // Their own rule first; if another now holds instead (a captive won over), that one.
    const rule = ruleId === BY_HAND ? null : world.ruleset.follow.find((entry) => entry.id === ruleId && holds(world, save, entry, person.id)) ?? followRuleFor(world, save, person.id);
    if (withYou && (ruleId === BY_HAND || rule)) {
      if (rule && rule.id !== ruleId) following[person.id] = rule.id;
      positions[person.id] = to;
      entries.push({ kind: 'move', at, characterId: person.id, from, to, minutes: 0, source: 'rule' });
      came.push(person);
      continue;
    }
    delete following[person.id];
    entries.push({ kind: 'follow', at, characterId: person.id, as: null, source: 'rule' });
    if (withYou) stayed.push(person);
  }
  return { positions, following, entries, came, stayed };
}
