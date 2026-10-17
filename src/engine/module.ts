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
import { appliesTo, forOwner, stateDefSchema, type StateDef } from './state';
import { STANDARD_RULESET_ID, withStandard } from './standard';

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

// How hard something is to act on: the Genesys ladder from Simple (0) to Formidable (5), or
// 'random', rolled once per save. By approach, or 'all' for every approach.
export const DIFFICULTY_NAMES = ['Simple', 'Easy', 'Average', 'Hard', 'Daunting', 'Formidable'] as const;
export const levelSchema = z.union([z.number().int().min(0).max(5), z.literal('random')]);
export const difficultySchema = z.record(z.string(), levelSchema).default({});
export const TIERS = ['minion', 'rival', 'nemesis'] as const;

export const placeSchema = z.object({
  id,
  name: z.string().min(1).max(120),
  description: text(8000).default(''),
  kind: z.enum(PLACE_KINDS).default('other'),
  parentLocationId: id.nullable().default(null),
  difficulty: difficultySchema,
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

// One stop in a day: from this hour until the next stop, the person is here doing this.
// The last stop runs on past midnight to the first, so someone asleep from 23:00 is still
// asleep at 01:00. Character Engine's shape.
export const scheduleRowSchema = z.object({
  fromHour: z.number().int().min(0).max(23),
  locationId: id,
  doing: text(400).default(''),
});

export const dayPlanSchema = z.object({
  id,
  name: z.string().min(1).max(80),
  rows: z.array(scheduleRowSchema).min(1).max(24),
});

// When a plan other than the first applies. Every field must match; an absent field matches
// anything. Weekday, month and day of the month count from zero; fromDay and toDay are
// absolute days since story zero, for a world with no week.
export const planRuleSchema = z.object({
  planId: id,
  when: z.object({
    weekday: z.number().int().min(0).optional(),
    month: z.number().int().min(0).optional(),
    monthDay: z.number().int().min(0).optional(),
    fromDay: z.number().int().min(0).optional(),
    toDay: z.number().int().min(0).optional(),
  }),
});

// Where someone is when the story is not watching. The first plan is the ordinary day; the
// first rule that matches picks another.
export const scheduleSchema = z.object({
  plans: z.array(dayPlanSchema).min(1).max(20),
  rules: z.array(planRuleSchema).max(50).default([]),
});

export const characterSchema = z.object({
  ...recordBase,
  description: text(8000).default(''),
  // The dossier. Orbis characters take these as free-form fields; the names follow Orbis's
  // persona record (appearance, personality, speech) so one shape serves both.
  role: text(200).optional(),
  // As Orbis's persona record writes them: "she/her", "he/him", "they/them", "it/its".
  // Unset reads as they/them.
  pronouns: text(40).optional(),
  appearance: text(4000).optional(),
  personality: text(4000).optional(),
  speech: text(4000).optional(),
  speciesId: id.optional(),
  factionIds: z.array(id).max(50).default([]),
  homeLocationId: id.optional(),
  workplaceLocationIds: z.array(id).max(20).default([]),
  schedule: scheduleSchema.optional(),
  // Starting values that differ from a state's own start.
  states: z.record(z.string(), z.number().int()).default({}),
  // This character's own maximum for a state, such as a minion's 2 Health. Bands with a
  // 'share' basis read against it.
  maxima: z.record(z.string(), z.number().int()).default({}),
  // Four Approaches charges, by approach: trained (+1, +2, +3), practiced (+1, +2), raw (+1).
  charges: z.record(z.string(), z.enum(['trained', 'practiced', 'raw'])).default({}),
  // The Four Approaches tier: sets how hard they are to act against and, unless `maxima`
  // says otherwise, their Health and Strain.
  tier: z.enum(TIERS).optional(),
  difficulty: difficultySchema,
}).passthrough();

// Two people and what lies between them, Character Engine's pair record. Not an Orbis
// collection yet; part of the Orbis proposal. `bondStateId` names a relationship-scoped
// state whose bands are the bond's tiers. `states` holds starting values, as on characters.
export const relationshipSchema = z.object({
  id,
  personIds: z.tuple([id, id]),
  bondStateId: id.optional(),
  // What the relationship is. Shared by both sides.
  shape: text(2000).default(''),
  // What happens in the room when both are there.
  together: text(1000).default(''),
  // What each side wants out of it, by character id.
  wants: z.record(z.string(), text(600)).default({}),
  states: z.record(z.string(), z.number().int()).default({}),
}).passthrough();

export const itemSchema = z.object({
  ...recordBase,
  description: text(8000).default(''),
  // Where it lies, or who carries it. Orbis items take free-form fields; these follow the
  // names Praxis's own records use.
  locationId: id.optional(),
  heldBy: id.optional(),
  difficulty: difficultySchema,
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

// Something the player can do at a place that the rules settle outright, such as signing
// the Covenant at the gate. Offered while its conditions hold; resolving it writes its
// effects to the player's character and hands the narrator its outcome.
export const sceneActionSchema = z.object({
  id,
  name: z.string().min(1).max(120),
  // What it does, for the player.
  summary: text(400).default(''),
  // Where it is offered. Empty means anywhere.
  placeIds: z.array(id).max(200).default([]),
  // People who must be here for it to be offered: the broker for a sale, the sellsword for a hire.
  present: z.array(id).max(8).default([]),
  // Conditions, all of which must hold: on the player's character, or on someone else's when
  // `characterId` names them.
  when: z.array(z.object({
    stateId: id,
    characterId: id.optional(),
    atLeast: z.number().int().optional(),
    atMost: z.number().int().optional(),
  })).max(8).default([]),
  // What it changes, in order: the player's states, or someone else's when `characterId`
  // names them. A purchase pays from your Coin and sets the person's contract.
  effects: z.array(z.object({
    stateId: id,
    characterId: id.optional(),
    set: z.number().int().optional(),
    add: z.number().int().optional(),
  })).min(1).max(8),
  // The player's line in the transcript.
  input: z.string().min(1).max(400),
  // What the narrator must show, for this turn only.
  outcome: z.string().min(1).max(1000),
}).passthrough();

// What a check costs: a change to the player's character, the place, or the target.
export const costSchema = z.object({
  stateId: id,
  who: z.enum(['player', 'place', 'target']),
  add: z.number().int(),
});

// One of the Four Approaches. Its rating is the character state with the same id. Failure
// and two or more threat cost what is listed here, paid by whoever owns the ground: an
// approach used as a secondary pays its owner's costs.
export const approachSchema = z.object({
  id,
  name: z.string().min(1).max(60),
  failure: z.array(costSchema).max(8).default([]),
  failureMinutes: z.number().int().min(0).max(100_000).default(0),
  threat: z.array(costSchema).max(8).default([]),
  threatMinutes: z.number().int().min(0).max(100_000).default(0),
}).passthrough();

// A condition that adds a setback die: the player hurt, the place watchful.
export const setbackSchema = z.object({
  stateId: id,
  who: z.enum(['player', 'place']),
  atLeast: z.number().int().optional(),
  atMost: z.number().int().optional(),
  // Only for these approaches. Empty means every approach.
  approaches: z.array(id).max(8).default([]),
  reason: z.string().min(1).max(200),
});

export const diceSchema = z.object({
  // Difficulty dice when nothing else sets it. Two is Genesys's Average.
  difficulty: z.number().int().min(0).max(5).default(2),
  // The player's states that hold Edge, Story Points and the hidden momentum count.
  edge: id.optional(),
  storyPoints: id.optional(),
  momentum: id.optional(),
  setbacks: z.array(setbackSchema).max(20).default([]),
  // What pushing costs the player: reusing a spent charge. Four Approaches: 2 Strain.
  push: z.object({ stateId: id, add: z.number().int() }).optional(),
});

// A full rest: waiting at least this long restores what is listed and resets charges.
export const restSchema = z.object({
  minutes: z.number().int().min(1).max(100_000).default(480),
  effects: z.array(z.object({ stateId: id, add: z.number().int().optional(), toMax: z.boolean().optional() })).max(8).default([]),
  resetCharges: z.boolean().default(true),
});

// An act with no state to wear down: it works or it fails, and fails at the approach's cost.
// Four Approaches: Finesse against a person (lift, slip past, plant).
export const deedSchema = z.object({
  kind: z.enum(['person', 'thing', 'place']),
  approach: id,
  label: z.string().min(1).max(120),
});

export const tierSchema = z.object({
  difficulty: z.number().int().min(0).max(5),
  maxima: z.record(z.string(), z.number().int()).default({}),
});

// A way someone can come along with you when you travel. It holds when any one of its
// conditions does: a state of theirs within bounds, or a bond with you at or above the tier
// its kind marks (StateDef.followsFrom).
export const followConditionSchema = z.union([
  z.object({ stateId: id, atLeast: z.number().int().optional(), atMost: z.number().int().optional() }).strict(),
  z.object({ bond: z.literal('follows') }).strict(),
]);

export const followRuleSchema = z.object({
  id,
  // The button: "Bring along as your captive".
  label: z.string().min(1).max(80),
  // How the narrator hears it: "your captive", "travelling with you".
  as: z.string().min(1).max(80),
  anyOf: z.array(followConditionSchema).min(1).max(8),
});

export const rulesetSchema = z.object({
  // "four-approaches/1" lays the standard ruleset beneath this one (standard.ts).
  extends: z.literal(STANDARD_RULESET_ID).optional(),
  states: z.array(stateDefSchema).max(500).default([]),
  // Absent means the real calendar (DEFAULT_CALENDAR).
  calendar: calendarSchema.optional(),
  travel: travelSchema.default({ walkKph: 4, tiers: [] }),
  actions: z.array(sceneActionSchema).max(1000).default([]),
  approaches: z.array(approachSchema).max(12).default([]),
  dice: diceSchema.optional(),
  rest: restSchema.optional(),
  deeds: z.array(deedSchema).max(40).default([]),
  follow: z.array(followRuleSchema).max(12).default([]),
  tiers: z.object({ minion: tierSchema.optional(), rival: tierSchema.optional(), nemesis: tierSchema.optional() }).optional(),
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
  relationships: z.array(relationshipSchema).max(5000).default([]),
  items: z.array(itemSchema).max(5000).default([]),
  ruleset: rulesetSchema.default({ states: [], travel: { walkKph: 4, tiers: [] }, actions: [], approaches: [], deeds: [], follow: [] }),
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
    if (state.npcLabels && state.npcLabels.length !== state.bands.length) {
      issue(['ruleset', 'states', index, 'npcLabels'], `There are ${state.bands.length} bands but ${state.npcLabels.length} labels for other people.`);
    }
  });

  const playerState = (state: StateDef | undefined) => Boolean(state && appliesTo(state, 'character', true));
  const placeState = (state: StateDef | undefined) => Boolean(state && appliesTo(state, 'place'));
  const approachIds = new Set(module.ruleset.approaches.map((approach) => approach.id));
  unique(module.ruleset.approaches.map((approach) => approach.id), ['ruleset', 'approaches']);
  module.ruleset.approaches.forEach((approach, index) => {
    if (!characterState(states.get(approach.id))) issue(['ruleset', 'approaches', index, 'id'], `An approach's rating is the character state "${approach.id}", which does not exist.`);
    (['failure', 'threat'] as const).forEach((kind) => approach[kind].forEach((cost, costIndex) => {
      const state = states.get(cost.stateId);
      const fits = cost.who === 'place' ? placeState(state) : cost.who === 'player' ? playerState(state) : characterState(state);
      if (!fits) issue(['ruleset', 'approaches', index, kind, costIndex, 'stateId'], `"${cost.stateId}" is not a state ${cost.who === 'place' ? 'a place' : 'a character'} holds.`);
    }));
  });
  module.ruleset.states.forEach((state, index) => {
    if (!state.approach || !approachIds.size) return;
    for (const approachId of [state.approach.owner, ...state.approach.secondary]) {
      if (!approachIds.has(approachId)) issue(['ruleset', 'states', index, 'approach'], `Unknown approach "${approachId}".`);
    }
  });
  const dice = module.ruleset.dice;
  if (dice) {
    if (dice.push && !playerState(states.get(dice.push.stateId))) issue(['ruleset', 'dice', 'push', 'stateId'], `"${dice.push.stateId}" is not a state the player's character holds.`);
    for (const key of ['edge', 'storyPoints', 'momentum'] as const) {
      const stateId = dice[key];
      if (stateId && !playerState(states.get(stateId))) issue(['ruleset', 'dice', key], `"${stateId}" is not a state the player's character holds.`);
    }
    dice.setbacks.forEach((setback, setbackIndex) => {
      const state = states.get(setback.stateId);
      if (!(setback.who === 'place' ? placeState(state) : playerState(state))) issue(['ruleset', 'dice', 'setbacks', setbackIndex, 'stateId'], `"${setback.stateId}" does not fit "${setback.who}".`);
    });
  }
  module.ruleset.rest?.effects.forEach((effect, effectIndex) => {
    if (!playerState(states.get(effect.stateId))) issue(['ruleset', 'rest', 'effects', effectIndex, 'stateId'], `"${effect.stateId}" is not a state the player's character holds.`);
  });
  module.characters.forEach((character, index) => {
    for (const approachId of Object.keys(character.charges)) {
      if (!approachIds.has(approachId)) issue(['characters', index, 'charges', approachId], `Unknown approach "${approachId}".`);
    }
    if (character.tier && !module.ruleset.tiers?.[character.tier]) issue(['characters', index, 'tier'], `The ruleset has no "${character.tier}" tier.`);
  });
  const checkDifficulty = (difficulty: Record<string, unknown>, path: (string | number)[]) => {
    for (const key of Object.keys(difficulty)) {
      if (key !== 'all' && !approachIds.has(key)) issue([...path, 'difficulty', key], `Unknown approach "${key}".`);
    }
  };
  module.characters.forEach((character, index) => checkDifficulty(character.difficulty, ['characters', index]));
  module.items.forEach((item, index) => checkDifficulty(item.difficulty, ['items', index]));
  module.world.places.forEach((place, index) => checkDifficulty(place.difficulty, ['world', 'places', index]));
  module.ruleset.deeds.forEach((deed, index) => {
    if (!approachIds.has(deed.approach)) issue(['ruleset', 'deeds', index, 'approach'], `Unknown approach "${deed.approach}".`);
  });
  unique(module.ruleset.follow.map((rule) => rule.id), ['ruleset', 'follow']);
  module.ruleset.follow.forEach((rule, index) => {
    rule.anyOf.forEach((condition, conditionIndex) => {
      if (!('stateId' in condition)) return;
      const state = states.get(condition.stateId);
      if (!state || !['char', 'npc'].includes(state.scope)) issue(['ruleset', 'follow', index, 'anyOf', conditionIndex, 'stateId'], `"${condition.stateId}" is not a state other people hold.`);
    });
  });
  unique(module.ruleset.actions.map((action) => action.id), ['ruleset', 'actions']);
  module.ruleset.actions.forEach((action, index) => {
    const path = ['ruleset', 'actions', index];
    action.placeIds.forEach((placeId, placeIndex) => {
      if (!places.has(placeId)) issue([...path, 'placeIds', placeIndex], `Unknown place "${placeId}".`);
    });
    // A condition or effect on the player, or on a named person who is not the player.
    const holds = (stateId: string, characterId: string | undefined) => {
      if (!characterId) return playerState(states.get(stateId));
      const state = states.get(stateId);
      return Boolean(state && characterIds.has(characterId) && characterId !== module.scenario.playerCharacterId && appliesTo(state, 'character', false));
    };
    action.present.forEach((personId, personIndex) => {
      if (!characterIds.has(personId)) issue([...path, 'present', personIndex], `Unknown character "${personId}".`);
    });
    action.when.forEach((condition, conditionIndex) => {
      if (!holds(condition.stateId, condition.characterId)) issue([...path, 'when', conditionIndex, 'stateId'], condition.characterId ? `"${condition.stateId}" is not a state ${condition.characterId} holds.` : `"${condition.stateId}" is not a state the player's character holds.`);
    });
    action.effects.forEach((effect, effectIndex) => {
      if (!holds(effect.stateId, effect.characterId)) issue([...path, 'effects', effectIndex, 'stateId'], effect.characterId ? `"${effect.stateId}" is not a state ${effect.characterId} holds.` : `"${effect.stateId}" is not a state the player's character holds.`);
      if ((effect.set === undefined) === (effect.add === undefined)) issue([...path, 'effects', effectIndex], 'An effect either sets a value or adds to it.');
    });
  });

  module.characters.forEach((character, index) => {
    if (character.homeLocationId !== undefined && !places.has(character.homeLocationId)) {
      issue(['characters', index, 'homeLocationId'], `Unknown place "${character.homeLocationId}".`);
    }
    for (const stateId of Object.keys(character.states)) {
      if (!characterState(states.get(stateId))) issue(['characters', index, 'states', stateId], `"${stateId}" is not a state a character holds.`);
    }
    for (const [stateId, maximum] of Object.entries(character.maxima)) {
      const state = states.get(stateId);
      if (!characterState(state)) issue(['characters', index, 'maxima', stateId], `"${stateId}" is not a state a character holds.`);
      else if (state && maximum <= Math.min(state.min, state.max)) issue(['characters', index, 'maxima', stateId], `A maximum of ${maximum} leaves no room above the minimum.`);
    }
  });

  module.items.forEach((item, index) => {
    if (item.locationId !== undefined && !places.has(item.locationId)) issue(['items', index, 'locationId'], `Unknown place "${item.locationId}".`);
    if (item.heldBy !== undefined && !characterIds.has(item.heldBy)) issue(['items', index, 'heldBy'], `Unknown character "${item.heldBy}".`);
  });

  module.characters.forEach((character, index) => {
    character.workplaceLocationIds.forEach((placeId, placeIndex) => {
      if (!places.has(placeId)) issue(['characters', index, 'workplaceLocationIds', placeIndex], `Unknown place "${placeId}".`);
    });
    const schedule = character.schedule;
    if (!schedule) return;
    if (character.id === module.scenario.playerCharacterId) issue(['characters', index, 'schedule'], 'The player character keeps no schedule; the player decides where they go.');
    unique(schedule.plans.map((plan) => plan.id), ['characters', index, 'schedule', 'plans']);
    const planIds = new Set(schedule.plans.map((plan) => plan.id));
    schedule.plans.forEach((plan, planIndex) => {
      const hours = new Set<number>();
      plan.rows.forEach((row, rowIndex) => {
        const path = ['characters', index, 'schedule', 'plans', planIndex, 'rows', rowIndex];
        if (hours.has(row.fromHour)) issue([...path, 'fromHour'], `Two stops start at ${row.fromHour}:00.`);
        hours.add(row.fromHour);
        if (!places.has(row.locationId)) issue([...path, 'locationId'], `Unknown place "${row.locationId}".`);
        else if (isArea(row.locationId)) issue([...path, 'locationId'], `"${row.locationId}" is an area, not somewhere to be.`);
      });
    });
    schedule.rules.forEach((rule, ruleIndex) => {
      if (!planIds.has(rule.planId)) issue(['characters', index, 'schedule', 'rules', ruleIndex, 'planId'], `Unknown plan "${rule.planId}".`);
    });
  });

  unique(module.relationships.map((relationship) => relationship.id), ['relationships']);
  const pairs = new Set<string>();
  module.relationships.forEach((relationship, index) => {
    const [a, b] = relationship.personIds;
    relationship.personIds.forEach((personId, personIndex) => {
      if (!characterIds.has(personId)) issue(['relationships', index, 'personIds', personIndex], `Unknown character "${personId}".`);
    });
    if (a === b) issue(['relationships', index, 'personIds'], 'A relationship needs two different people.');
    const pair = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (pairs.has(pair)) issue(['relationships', index, 'personIds'], 'These two already have a relationship.');
    pairs.add(pair);
    const bond = relationship.bondStateId ? states.get(relationship.bondStateId) : undefined;
    if (relationship.bondStateId && bond?.scope !== 'relationship') issue(['relationships', index, 'bondStateId'], `"${relationship.bondStateId}" is not a relationship state.`);
    for (const stateId of Object.keys(relationship.states)) {
      if (states.get(stateId)?.scope !== 'relationship') issue(['relationships', index, 'states', stateId], `"${stateId}" is not a relationship state.`);
    }
    for (const personId of Object.keys(relationship.wants)) {
      if (personId !== a && personId !== b) issue(['relationships', index, 'wants', personId], `"${personId}" is not one of the two.`);
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
export type Relationship = z.infer<typeof relationshipSchema>;
export type Schedule = z.infer<typeof scheduleSchema>;
export type DayPlan = z.infer<typeof dayPlanSchema>;
export type ScheduleRow = z.infer<typeof scheduleRowSchema>;
export type Item = z.infer<typeof itemSchema>;
export type WorldEntry = z.infer<typeof worldEntrySchema>;
export type Memory = z.infer<typeof memorySchema>;
export type SceneAction = z.infer<typeof sceneActionSchema>;
export type Approach = z.infer<typeof approachSchema>;
export type Deed = z.infer<typeof deedSchema>;
export type FollowRule = z.infer<typeof followRuleSchema>;
export type Level = z.infer<typeof levelSchema>;
export type Tier = (typeof TIERS)[number];
export type Cost = z.infer<typeof costSchema>;

// A state's definition as it applies to one owner, with that character's own maximum.
export function stateDefFor(module: PraxisModule, defId: string, ownerId: string): StateDef | undefined {
  const def = module.ruleset.states.find((state) => state.id === defId);
  if (!def) return undefined;
  const character = module.characters.find((entry) => entry.id === ownerId);
  const maximum = character?.maxima[defId] ?? (character?.tier ? module.ruleset.tiers?.[character.tier]?.maxima[defId] : undefined);
  return forOwner(def, maximum);
}

export type ModuleLoadResult =
  | { ok: true; module: PraxisModule }
  | { ok: false; errors: string[] };

// Parses and validates a module. Errors come back as readable lines with their location.
export function loadModule(raw: unknown): ModuleLoadResult {
  const parsed = moduleSchema.safeParse(withStandard(raw));
  if (parsed.success) return { ok: true, module: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues.map((entry) => `${entry.path.length ? entry.path.join('.') : 'module'}: ${entry.message}`),
  };
}
