// The save: everything that changes during play, kept apart from the module it plays.
//
// Every action is a pure function from (module, save) to a new save plus the ledger entries
// it added. A rejected action returns a reason and changes nothing, so the interface can show
// why without having to undo anything.
//
// Overrides are first-class. The player may set any state, the clock, or anyone's position
// directly; each is recorded in the ledger with `source: 'player'`, never hidden.

import { calendarOf, findPath, isArea, atlasOf, exitsFrom, type Exit } from './world';
import { stamp, timeBandOf, safeMinutes, datePhrase } from './clock';
import { stateDefFor, type Character, type Item, type Place, type PraxisModule } from './module';
import { appliesTo, clamp, pairKey, write, type ChangeSource, type StateTerminal, type StateValues, WORLD_OWNER } from './state';
import { DEFAULT_OPTIONS, calibrate, optionsSchema, type Options } from './options';
import { emptyJournal, type Journal } from './journal';
import { playable, type LocalRecord } from './records';
import { followSchedules, scheduledPositions } from './schedule';

export const SAVE_FORMAT = 'praxis-save/1';

export type LedgerEntry =
  | { kind: 'state'; at: number; defId: string; owner: string; from: number; to: number; source: ChangeSource }
  | { kind: 'clock'; at: number; from: number; to: number; source: ChangeSource; reason: string }
  | { kind: 'move'; at: number; characterId: string; from: string | null; to: string | null; minutes: number; source: ChangeSource };

// The mutable world, without the transcript or the ledger. A turn keeps the one from before
// it so undo can put it back exactly.
export interface WorldState {
  clock: number;
  positions: Readonly<Record<string, string>>;
  values: StateValues;
  // Charges spent, by character and approach. They come back when every charge on that
  // approach is spent, or on a full rest.
  spent: Readonly<Record<string, Readonly<Record<string, readonly number[]>>>>;
}

// What a check was, kept on its turn so the transcript can show the dice.
export interface CheckRecord {
  approach: string;
  approachName: string;
  target: { owner: string; defId: string; label: string };
  charge: number;
  push: boolean;
  storyPoint: boolean;
  // Settled without rolling, by the player's choice.
  auto: boolean;
  good: { kind: string; face: string }[];
  bad: { kind: string; face: string }[];
  netSuccess: number;
  netAdvantage: number;
  succeeded: boolean;
  triumph: boolean;
  despair: boolean;
  // The chance it had, from 0 to 1.
  chance: number;
}

// One exchange: what the player did, what the rules decided, and what the narrator wrote.
export interface Turn {
  id: string;
  // 'say' is the player's own words; 'action' is something the rules resolved, such as travel.
  kind: 'say' | 'action';
  // What the player wrote, or the action in the player's voice.
  input: string;
  // The outcome the narrator must render, used for this turn only. null for plain speech.
  directive: string | null;
  // The narration, once there is one. A reroll replaces it; the outcome stays resolved.
  reply: string | null;
  before: WorldState;
  // The ledger's length when the turn began; everything after belongs to this turn or later.
  ledgerStart: number;
  // The dice, when the turn was a check.
  check?: CheckRecord;
  // The first earlier turn the narrator is sent with this one. It moves only when the
  // story outgrows its share of the window, so the prompt's prefix stays the same between.
  windowStart: number;
}

export interface Save extends WorldState {
  format: typeof SAVE_FORMAT;
  module: { id: string; version: string };
  ledger: readonly LedgerEntry[];
  turns: readonly Turn[];
  journal: Journal;
  // People, places, things, groups and notes the player added. See records.ts.
  local: readonly LocalRecord[];
  options: Options;
}

export type ActionResult =
  | { ok: true; save: Save; entries: LedgerEntry[]; terminals: StateTerminal[] }
  | { ok: false; reason: string };

const reject = (reason: string): ActionResult => ({ ok: false, reason });

function commit(save: Save, changes: Partial<Save>, entries: LedgerEntry[], terminals: StateTerminal[] = []): ActionResult {
  return { ok: true, save: { ...save, ...changes, ledger: [...save.ledger, ...entries] }, entries, terminals };
}

export function playerOf(module: PraxisModule): string {
  return module.scenario.playerCharacterId;
}

// A fresh save at the scenario's start. Characters the scenario names are at the starting
// place; everyone else is where their day puts them, or at home if their home is somewhere
// a person can be.
export function startSave(module: PraxisModule): Save {
  const atlas = atlasOf(module);
  const { scenario } = module;
  const positions: Record<string, string> = {};
  for (const character of module.characters) {
    const home = character.homeLocationId;
    if (home && !isArea(atlas.places.get(home))) positions[character.id] = home;
  }
  Object.assign(positions, scheduledPositions(module, safeMinutes(scenario.startAt)));
  for (const characterId of [scenario.playerCharacterId, ...scenario.presentCharacterIds]) {
    positions[characterId] = scenario.startPlaceId;
  }

  // Only values that differ from a state's own start are stored, so a later change to the
  // module's starts still reaches every character that never moved off them.
  // Clamped here like every other write, so no stored value is ever out of bounds.
  const values: Record<string, Record<string, number>> = {};
  for (const character of module.characters) {
    const entries = Object.entries(character.states).flatMap(([defId, value]) => {
      const def = stateDefFor(module, defId, character.id);
      return def ? [[defId, clamp(def, value)] as const] : [];
    });
    if (entries.length) values[character.id] = Object.fromEntries(entries);
  }
  for (const relationship of module.relationships) {
    const owner = pairKey(...relationship.personIds);
    const entries = Object.entries(relationship.states).flatMap(([defId, value]) => {
      const def = stateDefFor(module, defId, owner);
      return def ? [[defId, clamp(def, value)] as const] : [];
    });
    if (entries.length) values[owner] = Object.fromEntries(entries);
  }

  return {
    format: SAVE_FORMAT,
    module: { id: module.id, version: module.version },
    clock: safeMinutes(scenario.startAt),
    positions,
    values,
    spent: {},
    ledger: [],
    turns: [],
    journal: emptyJournal(),
    local: [],
    options: { ...DEFAULT_OPTIONS },
  };
}

// Changes the save's own settings. Bad values are refused whole.
export function setOptions(save: Save, changes: Partial<Options>): { ok: true; save: Save } | { ok: false; reason: string } {
  const parsed = optionsSchema.safeParse({ ...save.options, ...changes });
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? 'Those settings are out of range.' };
  return { ok: true, save: { ...save, options: parsed.data } };
}

// Folds NovelAI's report of a prompt's real size into the save's token estimate.
export function recordPromptSize(save: Save, promptChars: number, promptTokens: number): Save {
  const tokensPerChar = calibrate(save.options.tokensPerChar, promptChars, promptTokens);
  return tokensPerChar === save.options.tokensPerChar ? save : { ...save, options: { ...save.options, tokensPerChar } };
}

export function placeOf(module: PraxisModule, save: Save, characterId: string): Place | null {
  const placeId = save.positions[characterId];
  return placeId ? atlasOf(playable(module, save.local)).places.get(placeId) ?? null : null;
}

// Things at a place, and things someone carries. Only local things have a whereabouts yet.
export function thingsAt(module: PraxisModule, save: Save, placeId: string): Item[] {
  return playable(module, save.local).items.filter((item) => item.locationId === placeId && !item.heldBy);
}

export function thingsHeldBy(module: PraxisModule, save: Save, characterId: string): Item[] {
  return playable(module, save.local).items.filter((item) => item.heldBy === characterId);
}

export interface Scene {
  place: Place;
  // Everyone at the player's place except the player.
  present: Character[];
  things: Item[];
  exits: Exit[];
  stamp: string;
  date: string;
  // The only time words the model will be given.
  timeBand: string;
}

export function sceneOf(module: PraxisModule, save: Save): Scene {
  const world = playable(module, save.local);
  const playerId = playerOf(world);
  const place = placeOf(world, save, playerId);
  if (!place) throw new Error('The player character is not anywhere. The save does not match its module.');
  const calendar = calendarOf(world);
  return {
    place,
    present: world.characters.filter((character) => character.id !== playerId && save.positions[character.id] === place.id),
    things: thingsAt(world, save, place.id),
    exits: exitsFrom(world, save.values, playerId, place.id),
    stamp: stamp(calendar, save.clock),
    date: datePhrase(calendar, save.clock),
    timeBand: timeBandOf(calendar, save.clock),
  };
}

// The player's character travels to a place by the quickest open way, and time passes.
export function travel(module: PraxisModule, save: Save, toPlaceId: string): ActionResult {
  const world = playable(module, save.local);
  const playerId = playerOf(world);
  const from = save.positions[playerId];
  if (!from) return reject('The player character is not anywhere.');
  const path = findPath(world, save.values, playerId, from, toPlaceId);
  if (!path.ok) return reject(path.reason);
  const to = save.clock + path.minutes;
  const entries: LedgerEntry[] = [
    { kind: 'move', at: to, characterId: playerId, from, to: toPlaceId, minutes: path.minutes, source: 'rule' },
  ];
  if (path.minutes > 0) entries.unshift({ kind: 'clock', at: save.clock, from: save.clock, to, source: 'rule', reason: 'travel' });
  return commit(save, { clock: to, positions: { ...save.positions, [playerId]: toPlaceId } }, entries);
}

// Time passes where the player is.
export function wait(save: Save, minutes: number): ActionResult {
  const amount = Math.round(minutes);
  if (!Number.isFinite(amount) || amount <= 0) return reject('Waiting takes a positive number of minutes.');
  const to = save.clock + amount;
  return commit(save, { clock: to }, [{ kind: 'clock', at: save.clock, from: save.clock, to, source: 'rule', reason: 'wait' }]);
}

// --- Overrides: the player sets something directly. ---

function ownerKindFor(module: PraxisModule, owner: string): 'world' | 'character' | 'place' | 'faction' | 'item' | 'relationship' | null {
  if (owner === WORLD_OWNER) return 'world';
  if (module.relationships.some((relationship) => pairKey(...relationship.personIds) === owner)) return 'relationship';
  if (module.characters.some((character) => character.id === owner)) return 'character';
  if (module.world.places.some((place) => place.id === owner)) return 'place';
  if (module.world.factions.some((faction) => faction.id === owner)) return 'faction';
  if (module.items.some((item) => item.id === owner)) return 'item';
  return null;
}

export function setState(module: PraxisModule, save: Save, defId: string, owner: string, value: number): ActionResult {
  const world = playable(module, save.local);
  const def = stateDefFor(world, defId, owner);
  if (!def) return reject(`There is no state "${defId}".`);
  const kind = ownerKindFor(world, owner);
  if (!kind) return reject(`There is no "${owner}" to hold ${def.name}.`);
  if (!appliesTo(def, kind, owner === playerOf(module))) return reject(`${def.name} does not apply to "${owner}".`);
  if (!Number.isFinite(value)) return reject('A state needs a number.');
  const result = write(save.values, def, owner, value, 'player');
  if (!result.change) return commit(save, {}, []);
  const entry: LedgerEntry = { kind: 'state', at: save.clock, ...result.change };
  return commit(save, { values: result.values }, [entry], result.terminal ? [result.terminal] : []);
}

// Setting the clock forward by hand moves people along their day like any other passing time.
export function setClock(module: PraxisModule, save: Save, minutes: number): ActionResult {
  if (!Number.isFinite(minutes)) return reject('The clock needs a number.');
  const to = safeMinutes(minutes);
  if (to === save.clock) return commit(save, {}, []);
  const set = commit(save, { clock: to }, [{ kind: 'clock', at: save.clock, from: save.clock, to, source: 'player', reason: 'set by hand' }]);
  if (!set.ok) return set;
  const followed = followSchedules(playable(module, save.local), set.save, save.clock, to);
  return { ...set, save: followed.save, entries: [...set.entries, ...followed.entries] };
}

// Puts a character somewhere, or nowhere with null, without travel or time.
export function placeCharacter(module: PraxisModule, save: Save, characterId: string, placeId: string | null): ActionResult {
  const world = playable(module, save.local);
  if (!world.characters.some((character) => character.id === characterId)) return reject(`There is no character "${characterId}".`);
  if (placeId !== null) {
    const place = atlasOf(world).places.get(placeId);
    if (!place) return reject(`There is no place "${placeId}".`);
    if (isArea(place)) return reject(`${place.name} is an area, not somewhere to be.`);
  }
  if (placeId === null && characterId === playerOf(module)) return reject('The player character has to be somewhere.');
  const from = save.positions[characterId] ?? null;
  if (from === placeId) return commit(save, {}, []);
  const positions: Record<string, string> = { ...save.positions };
  if (placeId === null) delete positions[characterId];
  else positions[characterId] = placeId;
  return commit(save, { positions }, [{ kind: 'move', at: save.clock, characterId, from, to: placeId, minutes: 0, source: 'player' }]);
}
