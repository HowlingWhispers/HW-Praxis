// A Praxis module: read-only canon for one playthrough.
//
//   world     Orbis record shapes, with Orbis field names and IDs. Orbis documents are
//             free-form JSON, so every record keeps fields this schema does not name; a
//             later Orbis loader then replaces a file read rather than a translation.
//             `routes` is the one Praxis addition: Orbis records a place's distance from a
//             hub, not the roads between places. It uses Orbis's own travel vocabulary
//             (distanceKm, terrain, routeClass) and is part of the Orbis proposal.
//   ruleset   The state catalog, the calendar and travel pricing; from v0.2, dice.
//   scenario  Where and when play starts, and who is present.
//
// Play never writes to a module. Current values live in the save.

import { z } from 'zod';
import { calendarSchema } from './clock';
import { appliesTo, stateDefSchema, type StateDef } from './state';

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

// Places that are areas on a map rather than somewhere to stand. They hold other places,
// are never a destination, and nobody walks through one to reach a sibling.
export const AREA_KINDS: readonly string[] = ['continent', 'major region', 'region', 'subregion', 'territory'];

export const placeSchema = z.object({
  id,
  name: z.string().min(1).max(120),
  description: text(8000).default(''),
  kind: z.enum(PLACE_KINDS).default('other'),
  parentLocationId: id.nullable().default(null),
}).passthrough();

// A condition on the player's character for using a route.
export const requirementSchema = z.object({
  stateId: id,
  atLeast: z.number().int(),
  // When set, the condition applies only when travelling toward this end of the route.
  toward: id.optional(),
  // What the player is told when the condition fails.
  reason: z.string().min(1).max(400),
});

export const routeSchema = z.object({
  id,
  from: id,
  to: id,
  distanceKm: z.number().min(0).max(10_000),
  terrain: text(200).default(''),
  routeClass: text(80).default(''),
  requires: z.array(requirementSchema).max(8).default([]),
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
  // Starting values that differ from a state's own start, such as an NPC tier's Health.
  states: z.record(z.string(), z.number().int()).default({}),
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
  routes: z.array(routeSchema).max(10_000).default([]),
  species: z.array(worldEntrySchema).max(500).default([]),
  factions: z.array(worldEntrySchema).max(500).default([]),
  societies: z.array(worldEntrySchema).max(500).default([]),
  families: z.array(worldEntrySchema).max(500).default([]),
  memories: z.array(memorySchema).max(5000).default([]),
});

// How long a hop between a place and the place inside it takes, by the depth of the inner
// place (the island is 0). A tier with no row is free. No default numbers: there is no
// honest guess at the scale of a world nobody has written yet.
export const travelTierSchema = z.object({
  tier: z.number().int().min(0).max(20),
  minutes: z.number().int().min(0).max(100_000),
});

export const travelSchema = z.object({
  // Orbis's own on-foot pace for its route estimates.
  walkKph: z.number().positive().max(100).default(4),
  tiers: z.array(travelTierSchema).max(21).default([]),
});

export const rulesetSchema = z.object({
  states: z.array(stateDefSchema).max(500).default([]),
  // Absent means the real calendar (DEFAULT_CALENDAR).
  calendar: calendarSchema.optional(),
  travel: travelSchema.default({ walkKph: 4, tiers: [] }),
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
  // For authors: what is placeholder, where the material came from.
  notes: text(8000).default(''),
  source: z.object({
    kind: z.enum(['orbis', 'local']),
    worldId: id.optional(),
    revision: z.string().max(80).optional(),
  }),
  world: worldSchema,
  characters: z.array(characterSchema).max(5000).default([]),
  items: z.array(itemSchema).max(5000).default([]),
  ruleset: rulesetSchema.default({ states: [], travel: { walkKph: 4, tiers: [] } }),
  scenario: scenarioSchema,
}).superRefine((module, context) => {
  const issue = (path: (string | number)[], message: string) => context.addIssue({ code: 'custom', path, message });

  const unique = (ids: string[], path: (string | number)[]) => {
    const seen = new Set<string>();
    ids.forEach((value, index) => {
      if (seen.has(value)) issue([...path, index, 'id'], `Duplicate id "${value}".`);
      seen.add(value);
    });
  };

  const places = new Map(module.world.places.map((place) => [place.id, place]));
  const characterIds = new Set(module.characters.map((character) => character.id));
  const states = new Map(module.ruleset.states.map((state) => [state.id, state]));
  const isArea = (placeId: string) => AREA_KINDS.includes(places.get(placeId)?.kind ?? '');
  const characterState = (state: StateDef | undefined) => Boolean(state && (appliesTo(state, 'character', true) || appliesTo(state, 'character', false)));

  unique(module.world.places.map((place) => place.id), ['world', 'places']);
  unique(module.world.routes.map((route) => route.id), ['world', 'routes']);
  unique(module.characters.map((character) => character.id), ['characters']);
  unique(module.ruleset.states.map((state) => state.id), ['ruleset', 'states']);

  module.world.places.forEach((place, index) => {
    if (place.parentLocationId !== null && !places.has(place.parentLocationId)) {
      issue(['world', 'places', index, 'parentLocationId'], `Unknown parent place "${place.parentLocationId}".`);
    }
  });

  // A place inside itself, at any depth, would hang every walk up the map.
  module.world.places.forEach((place, index) => {
    const seen = new Set<string>([place.id]);
    let parent = place.parentLocationId;
    while (parent !== null && places.has(parent)) {
      if (seen.has(parent)) {
        issue(['world', 'places', index, 'parentLocationId'], `Place "${place.id}" is inside itself.`);
        break;
      }
      seen.add(parent);
      parent = places.get(parent)?.parentLocationId ?? null;
    }
  });

  module.world.routes.forEach((route, index) => {
    for (const end of ['from', 'to'] as const) {
      const placeId = route[end];
      if (!places.has(placeId)) issue(['world', 'routes', index, end], `Unknown place "${placeId}".`);
      else if (isArea(placeId)) issue(['world', 'routes', index, end], `"${placeId}" is an area, not somewhere a route can end.`);
    }
    if (route.from === route.to) issue(['world', 'routes', index, 'to'], 'A route needs two different places.');
    route.requires.forEach((requirement, requirementIndex) => {
      const path = ['world', 'routes', index, 'requires', requirementIndex];
      if (!characterState(states.get(requirement.stateId))) {
        issue([...path, 'stateId'], `"${requirement.stateId}" is not a state a character holds.`);
      }
      if (requirement.toward !== undefined && requirement.toward !== route.from && requirement.toward !== route.to) {
        issue([...path, 'toward'], `"${requirement.toward}" is not an end of this route.`);
      }
    });
  });

  module.ruleset.states.forEach((state, index) => {
    if (state.bands.length > 0 && state.restBand >= state.bands.length) {
      issue(['ruleset', 'states', index, 'restBand'], `Resting band ${state.restBand} does not exist.`);
    }
  });

  module.characters.forEach((character, index) => {
    if (character.homeLocationId !== undefined && !places.has(character.homeLocationId)) {
      issue(['characters', index, 'homeLocationId'], `Unknown place "${character.homeLocationId}".`);
    }
    for (const stateId of Object.keys(character.states)) {
      if (!characterState(states.get(stateId))) issue(['characters', index, 'states', stateId], `"${stateId}" is not a state a character holds.`);
    }
  });

  const { scenario } = module;
  if (!places.has(scenario.startPlaceId)) issue(['scenario', 'startPlaceId'], `Unknown place "${scenario.startPlaceId}".`);
  else if (isArea(scenario.startPlaceId)) issue(['scenario', 'startPlaceId'], `"${scenario.startPlaceId}" is an area, not somewhere to start.`);
  if (!characterIds.has(scenario.playerCharacterId)) issue(['scenario', 'playerCharacterId'], `Unknown character "${scenario.playerCharacterId}".`);
  scenario.presentCharacterIds.forEach((characterId, index) => {
    if (!characterIds.has(characterId)) issue(['scenario', 'presentCharacterIds', index], `Unknown character "${characterId}".`);
    if (characterId === scenario.playerCharacterId) issue(['scenario', 'presentCharacterIds', index], 'The player character is always present.');
  });
});

export type PraxisModule = z.infer<typeof moduleSchema>;
export type Place = z.infer<typeof placeSchema>;
export type Route = z.infer<typeof routeSchema>;
export type Character = z.infer<typeof characterSchema>;

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
