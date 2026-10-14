// A Praxis module: read-only canon for one playthrough.
//
//   world     Orbis record shapes, with Orbis field names and IDs. Orbis documents are
//             free-form JSON, so every record keeps fields this schema does not name; a
//             later Orbis loader then replaces a file read rather than a translation.
//   ruleset   The state catalog and, from v0.2, approaches and dice.
//   scenario  Where and when play starts, and who is present.
//
// Play never writes to a module. Current values live in the save.

import { z } from 'zod';
import { stateDefSchema } from './state';

export const MODULE_FORMAT = 'praxis-module/1';

const id = z.string().min(1).max(200);
const text = (max: number) => z.string().max(max);

// Fields every Orbis library record shares.
const recordBase = {
  id,
  name: z.string().min(1).max(120),
  summary: text(2000).optional(),
  contentRating: z.enum(['sfw', 'adult']).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
};

export const PLACE_KINDS = [
  'continent', 'major region', 'region', 'subregion', 'territory', 'settlement', 'town', 'village',
  'district', 'wilderness', 'building', 'landmark', 'road or trail', 'river', 'lake', 'sea or ocean', 'other',
] as const;

export const placeSchema = z.object({
  id,
  name: z.string().min(1).max(120),
  description: text(8000).default(''),
  kind: z.enum(PLACE_KINDS).default('other'),
  parentLocationId: id.nullable().default(null),
}).passthrough();

// Species, factions, societies and families: the Orbis editor asks only for these two fields.
export const worldEntrySchema = z.object({
  id,
  name: z.string().min(1).max(120),
  description: text(8000).default(''),
}).passthrough();

// Orbis titles memories with `title`, not `name`.
export const memorySchema = z.object({
  id,
  title: z.string().min(1).max(200),
  description: text(8000).default(''),
}).passthrough();

export const characterSchema = z.object({
  ...recordBase,
  description: text(8000).default(''),
  speciesId: id.optional(),
  factionIds: z.array(id).max(50).default([]),
  homeLocationId: id.optional(),
}).passthrough();

export const itemSchema = z.object({
  ...recordBase,
  description: text(8000).default(''),
}).passthrough();

export const worldSchema = z.object({
  ...recordBase,
  identity: z.object({
    name: text(120).optional(),
    description: text(8000).optional(),
    genre: text(200).optional(),
    tone: text(200).optional(),
  }).passthrough().default({}),
  lore: z.record(z.string(), z.unknown()).default({}),
  rules: z.record(z.string(), z.unknown()).default({}),
  timeWeather: z.record(z.string(), z.unknown()).default({}),
  places: z.array(placeSchema).max(5000).default([]),
  species: z.array(worldEntrySchema).max(500).default([]),
  factions: z.array(worldEntrySchema).max(500).default([]),
  societies: z.array(worldEntrySchema).max(500).default([]),
  families: z.array(worldEntrySchema).max(500).default([]),
  memories: z.array(memorySchema).max(5000).default([]),
});

export const rulesetSchema = z.object({
  states: z.array(stateDefSchema).max(500).default([]),
});

export const scenarioSchema = z.object({
  title: z.string().min(1).max(200),
  startPlaceId: id,
  // Minutes since story zero.
  startAt: z.number().int().nonnegative().default(8 * 60),
  playerCharacterId: id,
  presentCharacterIds: z.array(id).max(200).default([]),
  opening: text(20000).default(''),
});

export const moduleSchema = z.object({
  format: z.literal(MODULE_FORMAT),
  id,
  name: z.string().min(1).max(200),
  version: z.string().min(1).max(40),
  source: z.object({
    kind: z.enum(['orbis', 'local']),
    worldId: id.optional(),
    revision: z.string().max(80).optional(),
  }),
  world: worldSchema,
  characters: z.array(characterSchema).max(5000).default([]),
  items: z.array(itemSchema).max(5000).default([]),
  ruleset: rulesetSchema.default({ states: [] }),
  scenario: scenarioSchema,
}).superRefine((module, context) => {
  const issue = (path: (string | number)[], message: string) => context.addIssue({ code: 'custom', path, message });

  const unique = (ids: string[], path: string) => {
    const seen = new Set<string>();
    ids.forEach((value, index) => {
      if (seen.has(value)) issue([path, index, 'id'], `Duplicate id "${value}".`);
      seen.add(value);
    });
  };

  const placeIds = new Set(module.world.places.map((place) => place.id));
  const characterIds = new Set(module.characters.map((character) => character.id));
  unique(module.world.places.map((place) => place.id), 'world.places');
  unique(module.characters.map((character) => character.id), 'characters');
  unique(module.ruleset.states.map((state) => state.id), 'ruleset.states');

  module.world.places.forEach((place, index) => {
    if (place.parentLocationId !== null && !placeIds.has(place.parentLocationId)) {
      issue(['world', 'places', index, 'parentLocationId'], `Unknown parent place "${place.parentLocationId}".`);
    }
  });

  // A place inside itself, at any depth, would hang every walk up the map.
  const parents = new Map(module.world.places.map((entry) => [entry.id, entry.parentLocationId]));
  module.world.places.forEach((place, index) => {
    const seen = new Set<string>([place.id]);
    let parent = place.parentLocationId;
    while (parent !== null && parents.has(parent)) {
      if (seen.has(parent)) {
        issue(['world', 'places', index, 'parentLocationId'], `Place "${place.id}" is inside itself.`);
        break;
      }
      seen.add(parent);
      parent = parents.get(parent) ?? null;
    }
  });

  module.ruleset.states.forEach((state, index) => {
    if (state.bands.length > 0 && state.restBand >= state.bands.length) {
      issue(['ruleset', 'states', index, 'restBand'], `Resting band ${state.restBand} does not exist.`);
    }
  });

  const { scenario } = module;
  if (!placeIds.has(scenario.startPlaceId)) issue(['scenario', 'startPlaceId'], `Unknown place "${scenario.startPlaceId}".`);
  if (!characterIds.has(scenario.playerCharacterId)) issue(['scenario', 'playerCharacterId'], `Unknown character "${scenario.playerCharacterId}".`);
  scenario.presentCharacterIds.forEach((characterId, index) => {
    if (!characterIds.has(characterId)) issue(['scenario', 'presentCharacterIds', index], `Unknown character "${characterId}".`);
  });
});

export type PraxisModule = z.infer<typeof moduleSchema>;

export type ModuleLoadResult =
  | { ok: true; module: PraxisModule }
  | { ok: false; errors: string[] };

// Parses and validates a module. Errors come back as readable lines with their location.
export function loadModule(raw: unknown): ModuleLoadResult {
  const parsed = moduleSchema.safeParse(raw);
  if (parsed.success) return { ok: true, module: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues.map((entry) => `${entry.path.length ? entry.path.join('.') : 'module'}: ${entry.message}`),
  };
}
