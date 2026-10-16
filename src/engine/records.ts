// Local records: people, places, things, groups and notes the player adds during play, and
// bonds the player starts between two people.
//
// They live in the save, never in the module, which stays as it was published. Fields use
// Orbis names (description, speciesId, factionIds, parentLocationId, kind), so a record can
// leave as an Orbis record later. `playable` lays them over the module, and every rule then
// treats them like canon: a local person can be present, a local place can be travelled to.

import { z } from 'zod';
import { AREA_KINDS, PLACE_KINDS, type Character, type Item, type Memory, type Place, type PraxisModule, type Relationship, type WorldEntry } from './module';
import { pairKey } from './state';
import { atlasOf, isArea } from './world';
import type { LedgerEntry, Save } from './session';

export const RECORD_TYPES = ['person', 'place', 'thing', 'group', 'note', 'bond'] as const;
export type RecordType = typeof RECORD_TYPES[number];

const id = z.string().min(1).max(200);

export const localRecordSchema = z.object({
  id,
  type: z.enum(RECORD_TYPES),
  name: z.string().trim().min(1).max(120),
  // A few words: a person's role, a place's character, what a thing is.
  summary: z.string().max(300).default(''),
  // What the narrator reads.
  description: z.string().max(8000).default(''),
  // For the player only. Never sent to the narrator.
  playerNote: z.string().max(4000).default(''),
  // People.
  speciesId: id.optional(),
  factionIds: z.array(id).max(20).default([]),
  // Places: what it is and what it is inside.
  kind: z.enum(PLACE_KINDS).optional(),
  parentLocationId: id.optional(),
  // Things: where it lies, or who carries it.
  locationId: id.optional(),
  heldBy: id.optional(),
  // Bonds: the two people, and the relationship state that holds its tiers. The
  // description is the relationship's shape.
  personIds: z.array(id).max(2).default([]),
  bondStateId: id.optional(),
  // The story minute it was added.
  createdAt: z.number().int().nonnegative(),
});

export type LocalRecord = z.infer<typeof localRecordSchema>;
export type LocalRecordInput = Omit<z.input<typeof localRecordSchema>, 'createdAt'> & { createdAt?: number };

// Marks a module that already has a save's records laid over it.
const LAYERED = Symbol('praxis.layered');
type Layered = PraxisModule & { [LAYERED]?: PraxisModule };

const layers = new WeakMap<PraxisModule, WeakMap<readonly LocalRecord[], PraxisModule>>();

export function isLocal(entry: { origin?: unknown } | undefined | null): boolean {
  return Boolean(entry && entry.origin === 'local');
}

// The module with a save's local records laid over it. Cached, so the same records give
// the same object, and the atlas built for it is reused until a record changes.
export function playable(module: PraxisModule, local: readonly LocalRecord[]): PraxisModule {
  const base = (module as Layered)[LAYERED] ?? module;
  if (!local.length) return base;
  let byRecords = layers.get(base);
  if (!byRecords) {
    byRecords = new WeakMap();
    layers.set(base, byRecords);
  }
  const cached = byRecords.get(local);
  if (cached) return cached;

  const of = (type: RecordType) => local.filter((record) => record.type === type);
  const people: Character[] = of('person').map((record) => ({
    id: record.id,
    name: record.name,
    role: record.summary || undefined,
    description: record.description,
    speciesId: record.speciesId,
    factionIds: record.factionIds,
    workplaceLocationIds: [],
    states: {},
    maxima: {},
    charges: {},
    origin: 'local',
  }));
  const places: Place[] = of('place').map((record) => ({
    id: record.id,
    name: record.name,
    description: record.description || record.summary,
    kind: record.kind ?? 'other',
    parentLocationId: record.parentLocationId ?? null,
    origin: 'local',
  }));
  const things: Item[] = of('thing').map((record) => ({
    id: record.id,
    name: record.name,
    summary: record.summary || undefined,
    description: record.description,
    locationId: record.locationId,
    heldBy: record.heldBy,
    origin: 'local',
  }));
  const groups: WorldEntry[] = of('group').map((record) => ({
    id: record.id,
    name: record.name,
    description: record.description || record.summary,
    origin: 'local',
  }));
  const bonds: Relationship[] = of('bond').filter((record) => record.personIds.length === 2).map((record) => ({
    id: record.id,
    name: record.name,
    personIds: [record.personIds[0]!, record.personIds[1]!],
    bondStateId: record.bondStateId,
    shape: record.description,
    together: '',
    wants: {},
    states: {},
    origin: 'local',
  }));
  const notes: Memory[] = of('note').map((record) => ({
    id: record.id,
    title: record.name,
    description: record.description || record.summary,
    kind: 'note',
    origin: 'local',
  }));

  const layered: Layered = {
    ...base,
    world: {
      ...base.world,
      places: [...base.world.places, ...places],
      factions: [...base.world.factions, ...groups],
      memories: [...base.world.memories, ...notes],
    },
    characters: [...base.characters, ...people],
    relationships: [...base.relationships, ...bonds],
    items: [...base.items, ...things],
    [LAYERED]: base,
  };
  byRecords.set(local, layered);
  return layered;
}

export type RecordResult =
  | { ok: true; save: Save; record: LocalRecord; entries: LedgerEntry[] }
  | { ok: false; reason: string };

function knownIds(module: PraxisModule): Set<string> {
  const { world } = module;
  return new Set([
    ...world.places, ...world.species, ...world.factions, ...world.societies, ...world.families, ...module.characters, ...module.items, ...module.relationships,
  ].map((entry) => entry.id).concat(world.memories.map((memory) => memory.id)));
}

// Checks a record against the module and the save's other records.
function problemWith(module: PraxisModule, save: Save, record: LocalRecord, replacing: string | null): string | null {
  const others = save.local.filter((entry) => entry.id !== replacing);
  const world = playable(module, others);
  const places = atlasOf(world).places;
  if (replacing === null && (knownIds(world).has(record.id) || others.some((entry) => entry.id === record.id))) return `The id "${record.id}" is already taken.`;
  if (record.speciesId && !world.world.species.some((species) => species.id === record.speciesId)) return 'That people is not in this world.';
  const groups = new Set([...world.world.factions, ...world.world.societies].map((group) => group.id));
  const unknownGroup = record.factionIds.find((groupId) => !groups.has(groupId));
  if (unknownGroup) return `There is no group "${unknownGroup}".`;
  if (record.type === 'place') {
    if (!record.parentLocationId) return 'Choose the place it is inside.';
    const parent = places.get(record.parentLocationId);
    if (!parent) return 'The place it is inside does not exist.';
    if (isArea(parent)) return `${parent.name} is a whole area. Put it inside somewhere you can stand, such as a town or a building.`;
    if (record.kind && AREA_KINDS.includes(record.kind)) return 'A local place cannot be a whole region.';
    if (replacing !== null) {
      // A place cannot end up inside itself.
      let at: string | null = record.parentLocationId;
      while (at !== null) {
        if (at === record.id) return 'A place cannot be inside itself.';
        at = places.get(at)?.parentLocationId ?? null;
      }
    }
  }
  if (record.type === 'bond') {
    const [a, b] = record.personIds;
    if (!a || !b || a === b) return 'A bond needs two different people.';
    if (![a, b].every((personId) => world.characters.some((character) => character.id === personId))) return 'That person does not exist.';
    const key = pairKey(a, b);
    if (world.relationships.some((relationship) => relationship.id !== replacing && pairKey(...relationship.personIds) === key)) return 'These two already have a bond.';
    if (record.bondStateId) {
      const def = world.ruleset.states.find((state) => state.id === record.bondStateId);
      if (!def || def.scope !== 'relationship') return 'That is not a kind of bond.';
    }
  }
  if (record.type === 'thing') {
    if (record.locationId && !places.has(record.locationId)) return 'That place does not exist.';
    if (record.heldBy && !world.characters.some((character) => character.id === record.heldBy)) return 'That person does not exist.';
  }
  return null;
}

// Adds a record. `placeId` puts a new person somewhere at once, recorded as the player's move.
export function addRecord(module: PraxisModule, save: Save, input: LocalRecordInput, placeId: string | null = null): RecordResult {
  const parsed = localRecordSchema.safeParse({ ...input, createdAt: input.createdAt ?? save.clock });
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? 'That record is incomplete.' };
  const record = parsed.data;
  const problem = problemWith(module, save, record, null);
  if (problem) return { ok: false, reason: problem };
  let next: Save = { ...save, local: [...save.local, record] };
  const entries: LedgerEntry[] = [];
  if (record.type === 'person' && placeId) {
    const moved = putPerson(module, next, record.id, placeId);
    if (!moved.ok) return moved;
    next = moved.save;
    entries.push(...moved.entries);
  }
  return { ok: true, save: next, record, entries };
}

export function updateRecord(module: PraxisModule, save: Save, recordId: string, changes: Partial<LocalRecordInput>): RecordResult {
  const current = save.local.find((record) => record.id === recordId);
  if (!current) return { ok: false, reason: 'That record no longer exists.' };
  const parsed = localRecordSchema.safeParse({ ...current, ...changes, id: current.id, type: current.type, createdAt: current.createdAt });
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? 'That record is incomplete.' };
  const record = parsed.data;
  const problem = problemWith(module, save, record, recordId);
  if (problem) return { ok: false, reason: problem };
  return { ok: true, save: { ...save, local: save.local.map((entry) => (entry.id === recordId ? record : entry)) }, record, entries: [] };
}

export function removeRecord(module: PraxisModule, save: Save, recordId: string): RecordResult {
  const record = save.local.find((entry) => entry.id === recordId);
  if (!record) return { ok: false, reason: 'That record no longer exists.' };
  if (record.type === 'place') {
    if (Object.values(save.positions).includes(recordId)) return { ok: false, reason: `Someone is at ${record.name}. Move them first.` };
    if (save.local.some((entry) => entry.parentLocationId === recordId || entry.locationId === recordId)) return { ok: false, reason: `Something else is inside ${record.name}. Remove or move it first.` };
  }
  if (record.type === 'group' && save.local.some((entry) => entry.factionIds.includes(recordId))) {
    return { ok: false, reason: `Someone belongs to ${record.name}. Take them out of it first.` };
  }
  const entries: LedgerEntry[] = [];
  const positions: Record<string, string> = { ...save.positions };
  if (positions[recordId] !== undefined) {
    entries.push({ kind: 'move', at: save.clock, characterId: recordId, from: positions[recordId] ?? null, to: null, minutes: 0, source: 'player' });
    delete positions[recordId];
  }
  // A person's bonds go with them.
  const local = save.local
    .filter((entry) => entry.id !== recordId && !(record.type === 'person' && entry.type === 'bond' && entry.personIds.includes(recordId)))
    .map((entry) => (entry.heldBy === recordId ? { ...entry, heldBy: undefined } : entry));
  return { ok: true, save: { ...save, local, positions, ledger: [...save.ledger, ...entries] }, record, entries };
}

// Moves a local or module person without time passing, as the player's own change.
function putPerson(module: PraxisModule, save: Save, personId: string, placeId: string): { ok: true; save: Save; entries: LedgerEntry[] } | { ok: false; reason: string } {
  const world = playable(module, save.local);
  const place = atlasOf(world).places.get(placeId);
  if (!place) return { ok: false, reason: 'That place does not exist.' };
  if (isArea(place)) return { ok: false, reason: `${place.name} is an area, not somewhere to be.` };
  const from = save.positions[personId] ?? null;
  if (from === placeId) return { ok: true, save, entries: [] };
  const entry: LedgerEntry = { kind: 'move', at: save.clock, characterId: personId, from, to: placeId, minutes: 0, source: 'player' };
  return { ok: true, save: { ...save, positions: { ...save.positions, [personId]: placeId }, ledger: [...save.ledger, entry] }, entries: [entry] };
}

// --- The records file: a save's local records on their own, to keep or bring into another save.

export const RECORDS_FORMAT = 'praxis-records/1';

export interface RecordsFile {
  format: typeof RECORDS_FORMAT;
  module: { id: string; version: string; name: string };
  records: LocalRecord[];
}

export function exportRecords(module: PraxisModule, save: Save): RecordsFile {
  return { format: RECORDS_FORMAT, module: { id: module.id, version: module.version, name: module.name }, records: [...save.local] };
}

export function readRecordsFile(raw: unknown): { ok: true; file: RecordsFile } | { ok: false; errors: string[] } {
  const schema = z.object({
    format: z.literal(RECORDS_FORMAT),
    module: z.object({ id, version: z.string().max(40), name: z.string().max(200) }),
    records: z.array(localRecordSchema).max(5000),
  });
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const notOurs = !raw || typeof raw !== 'object' || (raw as { format?: unknown }).format !== RECORDS_FORMAT;
    return { ok: false, errors: notOurs ? ['This is not a Praxis records file.'] : parsed.error.issues.map((issue) => `${issue.path.join('.') || 'file'}: ${issue.message}`) };
  }
  return { ok: true, file: parsed.data as RecordsFile };
}

// Brings records from a file into a save. Records whose id is already in use, or that point
// at something this world lacks, are skipped and named. Places go first, so a thing can
// lie in a place from the same file.
export function importRecords(module: PraxisModule, save: Save, records: readonly LocalRecord[]): { save: Save; added: number; skipped: string[] } {
  let next = save;
  let added = 0;
  const skipped: string[] = [];
  const order: RecordType[] = ['group', 'place', 'person', 'thing', 'note'];
  const sorted = [...records].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  for (const record of sorted) {
    const result = addRecord(module, next, { ...record, createdAt: record.createdAt });
    if (result.ok) {
      next = result.save;
      added += 1;
    } else {
      skipped.push(`${record.name}: ${result.reason}`);
    }
  }
  return { save: next, added, skipped };
}
