// Relationships: one record per pair, Character Engine's shape, and the bond between them.
//
// A relationship says what it is (its shape), what happens when both are in the room, and
// what each side wants. Its bond is an ordinary relationship-scoped state whose bands are
// the tiers, owned by the pair's key. The rules move it (a Flair triumph or despair against
// the other person, Four Approaches) and so can the player, by hand; the model never does.
//
// Relationships come from the module, and from bonds the player starts during play, which
// live in the save as local records.

import { pairKey, read, band, type StateDef } from './state';
import { stateDefFor, type Character, type PraxisModule, type Relationship } from './module';
import { addRecord, playable, type RecordResult } from './records';
import type { Save } from './session';

export interface Bond {
  relationship: Relationship;
  // The pair's key, which owns the bond's value.
  owner: string;
  def: StateDef | undefined;
  value: number;
  // The tier's words, or '' without a bond state.
  tier: string;
  // The other person, seen from the one asked about.
  other: Character;
}

export function relationshipBetween(world: PraxisModule, a: string, b: string): Relationship | undefined {
  if (!a || !b || a === b) return undefined;
  const key = pairKey(a, b);
  return world.relationships.find((relationship) => pairKey(...relationship.personIds) === key);
}

function bondOf(world: PraxisModule, save: Save, relationship: Relationship, viewerId: string): Bond | null {
  const owner = pairKey(...relationship.personIds);
  const otherId = relationship.personIds[0] === viewerId ? relationship.personIds[1] : relationship.personIds[0];
  const other = world.characters.find((character) => character.id === otherId);
  if (!other) return null;
  const def = relationship.bondStateId ? stateDefFor(world, relationship.bondStateId, owner) : undefined;
  const value = def ? read(save.values, def, owner) : 0;
  return { relationship, owner, def, value, tier: def ? band(def, value).label : '', other };
}

export function bondBetween(module: PraxisModule, save: Save, viewerId: string, otherId: string): Bond | null {
  const world = playable(module, save.local);
  const relationship = relationshipBetween(world, viewerId, otherId);
  return relationship ? bondOf(world, save, relationship, viewerId) : null;
}

// Everyone someone has a relationship with, in the module's order.
export function bondsOf(module: PraxisModule, save: Save, characterId: string): Bond[] {
  const world = playable(module, save.local);
  return world.relationships
    .filter((relationship) => relationship.personIds.includes(characterId))
    .map((relationship) => bondOf(world, save, relationship, characterId))
    .filter((bond): bond is Bond => bond !== null);
}

// "The gate Arbiter and you", or two names, for the ledger and the narrator.
export function pairName(world: PraxisModule, owner: string, viewerId?: string): string {
  const relationship = world.relationships.find((entry) => pairKey(...entry.personIds) === owner);
  if (!relationship) return owner;
  const names = relationship.personIds.map((personId) => (personId === viewerId ? 'you' : world.characters.find((character) => character.id === personId)?.name ?? personId));
  const ordered = names[0] === 'you' ? [names[1]!, names[0]] : names;
  return `${ordered[0]} and ${ordered[1] === 'you' ? 'you' : ordered[1]!.replace(/^The /, 'the ').replace(/^A /, 'a ')}`;
}

// Relationship-scoped states a bond can be: the module's bond tiers, for the player to pick
// from when starting one.
export function bondKinds(module: PraxisModule): StateDef[] {
  return module.ruleset.states.filter((def) => def.scope === 'relationship' && def.bands.length > 0);
}

// Starts a bond between the player's character and someone, as a local record. `id` comes
// in from outside so the engine stays deterministic.
export function startBond(module: PraxisModule, save: Save, id: string, otherId: string, bondStateId: string): RecordResult {
  const world = playable(module, save.local);
  const playerId = world.scenario.playerCharacterId;
  const other = world.characters.find((character) => character.id === otherId);
  const kind = world.ruleset.states.find((def) => def.id === bondStateId);
  if (!other) return { ok: false, reason: 'That person does not exist.' };
  if (!kind || kind.scope !== 'relationship') return { ok: false, reason: 'That is not a kind of bond.' };
  return addRecord(module, save, {
    id,
    type: 'bond',
    name: `You and ${other.name.replace(/^The /, 'the ').replace(/^A /, 'a ')}`,
    summary: kind.name,
    description: '',
    personIds: [playerId, otherId],
    bondStateId,
  });
}
