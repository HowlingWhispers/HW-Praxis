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
import type { Character, Place, PraxisModule } from './module';
import { appliesTo, clamp, write, type ChangeSource, type StateTerminal, type StateValues, WORLD_OWNER } from './state';

export const SAVE_FORMAT = 'praxis-save/1';

export type LedgerEntry =
  | { kind: 'state'; at: number; defId: string; owner: string; from: number; to: number; source: ChangeSource }
  | { kind: 'clock'; at: number; from: number; to: number; source: ChangeSource; reason: string }
  | { kind: 'move'; at: number; characterId: string; from: string | null; to: string | null; minutes: number; source: ChangeSource };

export interface Save {
  format: typeof SAVE_FORMAT;
  module: { id: string; version: string };
  // Minutes since story zero.
  clock: number;
  // Where each character is. A character with no entry is nowhere the story is looking.
  positions: Readonly<Record<string, string>>;
  values: StateValues;
  ledger: readonly LedgerEntry[];
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
// place; everyone else is at home if their home is somewhere a person can be.
export function startSave(module: PraxisModule): Save {
  const atlas = atlasOf(module);
  const { scenario } = module;
  const positions: Record<string, string> = {};
  for (const character of module.characters) {
    const home = character.homeLocationId;
    if (home && !isArea(atlas.places.get(home))) positions[character.id] = home;
  }
  for (const characterId of [scenario.playerCharacterId, ...scenario.presentCharacterIds]) {
    positions[characterId] = scenario.startPlaceId;
  }

  // Only values that differ from a state's own start are stored, so a later change to the
  // module's starts still reaches every character that never moved off them.
  // Clamped here like every other write, so no stored value is ever out of bounds.
  const values: Record<string, Record<string, number>> = {};
  for (const character of module.characters) {
    const entries = Object.entries(character.states).flatMap(([defId, value]) => {
      const def = module.ruleset.states.find((state) => state.id === defId);
      return def ? [[defId, clamp(def, value)] as const] : [];
    });
    if (entries.length) values[character.id] = Object.fromEntries(entries);
  }

  return {
    format: SAVE_FORMAT,
    module: { id: module.id, version: module.version },
    clock: safeMinutes(scenario.startAt),
    positions,
    values,
    ledger: [],
  };
}

export function placeOf(module: PraxisModule, save: Save, characterId: string): Place | null {
  const placeId = save.positions[characterId];
  return placeId ? atlasOf(module).places.get(placeId) ?? null : null;
}

export interface Scene {
  place: Place;
  // Everyone at the player's place except the player.
  present: Character[];
  exits: Exit[];
  stamp: string;
  date: string;
  // The only time words the model will be given.
  timeBand: string;
}

export function sceneOf(module: PraxisModule, save: Save): Scene {
  const playerId = playerOf(module);
  const place = placeOf(module, save, playerId);
  if (!place) throw new Error('The player character is not anywhere. The save does not match its module.');
  const calendar = calendarOf(module);
  return {
    place,
    present: module.characters.filter((character) => character.id !== playerId && save.positions[character.id] === place.id),
    exits: exitsFrom(module, save.values, playerId, place.id),
    stamp: stamp(calendar, save.clock),
    date: datePhrase(calendar, save.clock),
    timeBand: timeBandOf(calendar, save.clock),
  };
}

// The player's character travels to a place by the quickest open way, and time passes.
export function travel(module: PraxisModule, save: Save, toPlaceId: string): ActionResult {
  const playerId = playerOf(module);
  const from = save.positions[playerId];
  if (!from) return reject('The player character is not anywhere.');
  const path = findPath(module, save.values, playerId, from, toPlaceId);
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

function ownerKindFor(module: PraxisModule, owner: string): 'world' | 'character' | 'place' | 'faction' | 'item' | null {
  if (owner === WORLD_OWNER) return 'world';
  if (module.characters.some((character) => character.id === owner)) return 'character';
  if (module.world.places.some((place) => place.id === owner)) return 'place';
  if (module.world.factions.some((faction) => faction.id === owner)) return 'faction';
  if (module.items.some((item) => item.id === owner)) return 'item';
  return null;
}

export function setState(module: PraxisModule, save: Save, defId: string, owner: string, value: number): ActionResult {
  const def = module.ruleset.states.find((state) => state.id === defId);
  if (!def) return reject(`There is no state "${defId}".`);
  const kind = ownerKindFor(module, owner);
  if (!kind) return reject(`There is no "${owner}" to hold ${def.name}.`);
  if (!appliesTo(def, kind, owner === playerOf(module))) return reject(`${def.name} does not apply to "${owner}".`);
  if (!Number.isFinite(value)) return reject('A state needs a number.');
  const result = write(save.values, def, owner, value, 'player');
  if (!result.change) return commit(save, {}, []);
  const entry: LedgerEntry = { kind: 'state', at: save.clock, ...result.change };
  return commit(save, { values: result.values }, [entry], result.terminal ? [result.terminal] : []);
}

export function setClock(save: Save, minutes: number): ActionResult {
  if (!Number.isFinite(minutes)) return reject('The clock needs a number.');
  const to = safeMinutes(minutes);
  if (to === save.clock) return commit(save, {}, []);
  return commit(save, { clock: to }, [{ kind: 'clock', at: save.clock, from: save.clock, to, source: 'player', reason: 'set by hand' }]);
}

// Puts a character somewhere, or nowhere with null, without travel or time.
export function placeCharacter(module: PraxisModule, save: Save, characterId: string, placeId: string | null): ActionResult {
  if (!module.characters.some((character) => character.id === characterId)) return reject(`There is no character "${characterId}".`);
  if (placeId !== null) {
    const place = atlasOf(module).places.get(placeId);
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
