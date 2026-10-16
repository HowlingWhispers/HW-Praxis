// The context compiler: what the narrator is sent, built in one place.
//
// Every part has one home, and the parts run from what never changes to what changes every
// turn, so consecutive calls share the longest opening and NovelAI can reuse it:
//
//   system      1. Directions: how to narrate, and what the notes are     never
//               2. The world: identity, established facts, world rules    never
//               3. Names in this world: who and where, one line each,    when a record is added
//                  no descriptions (those are lore)
//               4. The story so far: the journal                         when an entry is kept
//   turns       5. The transcript, from the window's start               grows at the end; its
//                                                                         start moves at a cut
//   notes       6. [ Lore ] entries: you, the people here (their          when people come, go
//                  profiles), the groups and history bearing on the       or are named
//                  scene, and records just named
//               7. [ Scene ]: where you are and what it is like now,      every turn
//                  who is here and what they are doing, what shows
//                  (statuses in words), the ways out
//               8. [ Outcome ]: what the rules decided, and how to show it   this turn only
//   player      9. The player's words, last
//
// The notes travel as their own system message just before the player's words, so the
// player's turn holds only what the player wrote. A note is in square brackets, which mark
// game text; the story's own formatting is *narration and action* in asterisks, speech as
// plain text, and (thoughts) in parentheses.
//
// Nothing is said twice: a person's profile is lore while they are here, and the scene says
// only that they are here, what they are doing and what shows; a place's description is the
// scene's when you are there and lore when it is named; the names list carries no
// descriptions at all.
//
// The window. The transcript gets what the model's window has left after a fixed reserve
// for everything else. When it outgrows that, a whole piece leaves at once (Options
// .pieceTokens), so its start stays put between cuts and the prefix above stays reusable;
// a window that slid every turn would change the prompt from its first transcript line
// down on every call. Before a piece leaves, the journal is asked to record it.
//
// A state reaches the model only through its bands, in words, and only off its resting band;
// the clock only through its time band; an outcome only for the turn it belongs to.
// The interface shows these exact messages, so what the player inspects is what was sent.

import { calendarOf, exitsFrom } from './world';
import { timeBandOf } from './clock';
import { stateDefFor, type Character, type Place, type PraxisModule, type WorldEntry } from './module';
import { fact, pairKey, read, WORLD_OWNER, type StateDef } from './state';
import { mentionedNotes, sentencesUpTo } from './mentions';
import { doingNow } from './schedule';
import { pairName } from './relationships';
import { MOMENT_RESERVE, estimateTokens } from './options';
import { journalBlock } from './journal';
import { playable } from './records';
import { playerOf, placeOf, thingsAt, thingsHeldBy, type Save, type Turn } from './session';
import { capital, definite, listOf as list, midSentence, sentence } from './words';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// The narrator's standing instructions, in what-to-do terms: a rule phrased as "never X"
// tends to put X in the model's mind. Present-moment rules come first.
export function narratorRules(playerName: string): string {
  const player = playerName.replace(/^(The|A|An) /, (word) => word.toLowerCase());
  return [
    `You narrate a text adventure. The player plays ${player}, written as "you". You play the world and everyone else in it.`,
    `Each reply is the next beat of the scene, and only that. Show how the world answers what the player just did, then stop where the player can act again. Time moves only as far as the player's action carries it. The player decides what ${player} says, does, thinks and feels.`,
    'Notes in [square brackets] are outside the story: from the game, or from the player. They are true. Use what they say, in your own words, and keep the notes themselves out of the story.',
    '- [ Lore ] notes are background: who someone is, what a place, group or piece of history is. Draw on them when they matter.',
    '- The [ Scene ] note is how things stand right now: where you are, who is here and what they are doing, and what shows.',
    '- An [ Outcome ] note is what the rules decided about what the player just did. It has already happened. Show it in this reply, and let it change what people do next.',
    'When there is no Outcome, show the player\'s attempt and how the world answers it, and leave the result open. People who are not in the Scene stay offstage until a note says they arrive.',
    'Write in second person, present tense, in concrete physical detail: what can be seen, heard, smelled and touched. One to three short paragraphs. Narration and action go in *asterisks*. Speech is plain text, with no quotation marks. Thoughts go in (parentheses), and nobody else hears them.',
  ].join('\n');
}

const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);

function worldDigest(module: PraxisModule): string {
  const { world } = module;
  const parts: string[] = [`World: ${world.identity.name ?? world.name}.`];
  if (world.identity.genre) parts.push(`Genre: ${world.identity.genre}.`);
  if (world.identity.tone) parts.push(`Tone: ${world.identity.tone}.`);
  if (world.identity.description) parts.push(world.identity.description);
  const facts = world.lore.importantFacts;
  if (Array.isArray(facts)) {
    const lines = facts.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '');
    if (lines.length) parts.push(`Established facts:\n${lines.map((entry) => `- ${entry}`).join('\n')}`);
  }
  const constraints = world.rules.constraints;
  if (typeof constraints === 'string' && constraints.trim()) parts.push(`World rules: ${constraints.trim()}`);
  return parts.join('\n');
}

const inSentence = (name: string) => (name.startsWith('The ') ? `the ${name.slice(4)}` : name);

// Who and where, one line each, so the narrator reaches for what exists instead of inventing
// it. Names only: what someone or somewhere is like is lore, sent when it is needed. Capped:
// later entries are left out first. The player's own notes are sent here in full.
const NAMES_TOKENS = 1200;

export function whoIsWho(world: PraxisModule, playerId: string, tokensPerChar: number): string {
  const places = new Map(world.world.places.map((place) => [place.id, place]));
  const groupName = new Map([...world.world.factions, ...world.world.societies].map((group) => [group.id, group.name]));
  const speciesName = new Map(world.world.species.map((species) => [species.id, species.name]));

  const groups = [
    ...world.world.factions.map((group) => `${group.name} (faction)`),
    ...world.world.societies.map((group) => `${group.name} (society)`),
  ];
  const people = world.characters.filter((character) => character.id !== playerId).map((character) => {
    const role = typeof character.role === 'string' && character.role.trim() ? midSentence(character.role.trim()) : '';
    const species = character.speciesId ? speciesName.get(character.speciesId) : undefined;
    const of = character.factionIds.map((groupId) => groupName.get(groupId)).filter(Boolean).map((name) => inSentence(name!));
    const home = character.homeLocationId ? places.get(character.homeLocationId)?.name : undefined;
    return [character.name, role, species, of.length ? `of ${of.join(' and ')}` : '', home ? `usually at ${inSentence(home)}` : ''].filter(Boolean).join(', ');
  });
  const depthOf = (place: Place): number => {
    let depth = 0;
    let parent = place.parentLocationId;
    while (parent !== null && depth < 20) { depth += 1; parent = places.get(parent)?.parentLocationId ?? null; }
    return depth;
  };
  const placeLines = [...world.world.places]
    .sort((a, b) => depthOf(a) - depthOf(b))
    .map((place) => {
      const parent = place.parentLocationId ? places.get(place.parentLocationId)?.name : undefined;
      const where = [place.kind !== 'other' ? place.kind : '', parent ? `in ${parent}` : ''].filter(Boolean).join(', ');
      return `${place.name}${where ? ` (${where})` : ''}`;
    });
  const notes = world.world.memories
    .filter((memory) => memory.origin === 'local')
    .map((memory) => `${memory.title}${memory.description ? `: ${memory.description.trim()}` : ''}`);

  const sections: [string, string[]][] = [['People', people], ['Places', placeLines], ['Groups', groups], ['Your notes', notes]];
  const out: string[] = [];
  let used = 0;
  for (const [title, lines] of sections) {
    const kept: string[] = [];
    for (const entry of lines) {
      const cost = estimateTokens(entry, tokensPerChar) + 1;
      if (used + cost > NAMES_TOKENS) break;
      kept.push(`- ${entry}`);
      used += cost;
    }
    if (kept.length) out.push(`${title}:\n${kept.join('\n')}`);
  }
  return out.length ? `Names in this world:\n${out.join('\n')}` : '';
}

// The part of the system message that changes only when the world does.
export function systemPrefix(world: PraxisModule, save: Save): string {
  const playerId = playerOf(world);
  const who = whoIsWho(world, playerId, save.options.tokensPerChar);
  const player = world.characters.find((character) => character.id === playerId)?.name ?? 'the player character';
  return [narratorRules(player), worldDigest(world), who].filter(Boolean).join('\n\n');
}

function placePath(world: PraxisModule, place: Place): string {
  const names: string[] = [place.name];
  const byId = new Map(world.world.places.map((entry) => [entry.id, entry]));
  let parent = place.parentLocationId;
  while (parent !== null && names.length < 8) {
    const next = byId.get(parent);
    if (!next) break;
    names.push(next.name);
    parent = next.parentLocationId;
  }
  return names.join(', ');
}

function ancestry(world: PraxisModule, place: Place): string[] {
  const byId = new Map(world.world.places.map((entry) => [entry.id, entry]));
  const out = [place.id];
  let parent = place.parentLocationId;
  while (parent !== null && out.length < 20) {
    out.push(parent);
    parent = byId.get(parent)?.parentLocationId ?? null;
  }
  return out;
}

// "Lucan Abreu, the High Arbiter, of the Humans": who someone is, before their description.
function headOf(world: PraxisModule, character: Character): string {
  const species = world.world.species.find((entry) => entry.id === character.speciesId)?.name;
  const role = typeof character.role === 'string' ? midSentence(character.role) : '';
  return [character.name, role, species ? `of the ${species.replace(/^The /, '')}` : ''].filter(Boolean).join(', ');
}

// A profile as one lore entry: who they are, how they look, carry themselves and speak.
// While the room has space, everything; after that, who they are and their first sentence.
const PRESENT_TOKENS = 1200;
const DOSSIER_CHARS = 420;

function profiles(world: PraxisModule, save: Save, present: readonly Character[]): string[] {
  let used = 0;
  return present.map((character) => {
    const head = headOf(world, character);
    const description = character.description ? ` ${sentence(character.description)}` : '';
    const short = `${head}.${character.description ? ` ${sentencesUpTo(character.description, 200)}` : ''}`;
    const extras = ([['Looks', character.appearance], ['Manner', character.personality], ['Speech', character.speech]] as const)
      .filter(([, value]) => typeof value === 'string' && value.trim())
      .map(([label, value]) => `${label}: ${sentence(sentencesUpTo(value as string, DOSSIER_CHARS))}`);
    const full = `${head}.${description}${extras.length ? ` ${extras.join(' ')}` : ''}`;
    const cost = estimateTokens(full, save.options.tokensPerChar);
    const pick = used + cost <= PRESENT_TOKENS ? full : short;
    used += estimateTokens(pick, save.options.tokensPerChar);
    return pick;
  });
}

// Groups and history that bear on a scene: groups its people belong to, groups whose
// territory or settlements include the place, the societies those groups belong to, and
// memories tied to the place or its people. Orbis field names throughout.
export function bearingOn(world: PraxisModule, place: Place, people: readonly Character[]): { groups: WorldEntry[]; memories: { id: string; title: string; description: string }[] } {
  const where = new Set(ancestry(world, place));
  const who = new Set(people.map((person) => person.id));
  const member = new Set(people.flatMap((person) => person.factionIds));
  const located = (entry: Record<string, unknown>) =>
    [...ids(entry.territoryLocationIds), ...ids(entry.settlementLocationIds), ...ids(entry.locationIds)].some((placeId) => where.has(placeId));
  const all = [...world.world.factions, ...world.world.societies];
  const chosen = new Set(all.filter((group) => member.has(group.id) || located(group)).map((group) => group.id));
  for (const society of world.world.societies) {
    if (ids(society.factionIds).some((factionId) => chosen.has(factionId))) chosen.add(society.id);
  }
  const memories = world.world.memories
    .filter((memory) => memory.origin !== 'local')
    .filter((memory) => ids(memory.locationIds).some((placeId) => where.has(placeId)) || ids(memory.affectedCharacterIds).some((personId) => who.has(personId)))
    .map((memory) => ({ id: memory.id, title: memory.title, description: memory.description }));
  return { groups: all.filter((group) => chosen.has(group.id)), memories };
}

// "The gate Arbiter and the garrison guard", "The gate Arbiter and you".
function pairOf(world: PraxisModule, owner: string, playerId: string): string {
  const relationship = world.relationships.find((entry) => pairKey(...entry.personIds) === owner);
  if (!relationship) return capital(pairName(world, owner, playerId));
  const names = relationship.personIds.map((personId) => (personId === playerId ? 'you' : definite(world.characters.find((character) => character.id === personId)?.name ?? personId)));
  const ordered = names[0] === 'you' ? [names[1]!, 'you'] : names;
  return capital(`${ordered[0]} and ${midSentence(ordered[1]!)}`);
}

// What lies between people who are both here, the player included, as lore; and the bond's
// tier, when it is off rest, as something that shows in the scene.
function between(world: PraxisModule, save: Save, people: readonly Character[]): { lore: string[]; shows: string[] } {
  const playerId = playerOf(world);
  const here = new Set(people.map((person) => person.id));
  const lore: string[] = [];
  const shows: string[] = [];
  for (const relationship of world.relationships) {
    if (!relationship.personIds.every((personId) => here.has(personId))) continue;
    const owner = pairKey(...relationship.personIds);
    const names = pairOf(world, owner, playerId);
    const wants = Object.entries(relationship.wants)
      .filter(([personId, want]) => personId !== playerId && want.trim())
      .map(([personId, want]) => `${definite(world.characters.find((character) => character.id === personId)?.name ?? personId)} wants ${midSentence(want.trim()).replace(/\.$/, '')}.`);
    const parts = [sentence(relationship.shape), relationship.together.trim() ? `Together: ${sentence(relationship.together)}` : '', ...wants].filter(Boolean);
    if (parts.length) lore.push(`${names}. ${parts.join(' ')}`);
    const def = relationship.bondStateId ? stateDefFor(world, relationship.bondStateId, owner) : undefined;
    if (def) {
      const tier = fact(def.line ? def : { ...def, line: '[|name|: |bandLabel|]' }, names, read(save.values, def, owner));
      if (tier) shows.push(tier);
    }
  }
  return { lore, shows };
}

type FactOwner = 'world' | 'character' | 'place' | 'faction' | 'item';

// What shows about one owner, in catalog order: every banded state off its resting band, in
// words: "You are hurt.", "A garrison guard has given way, thoroughly convinced."
function statusOf(world: PraxisModule, save: Save, ownerId: string, ownerName: string, kind: FactOwner): string[] {
  const isPlayer = kind === 'character' && ownerId === playerOf(world);
  const fits = (def: StateDef) => {
    switch (kind) {
      case 'character': return def.scope === 'char' || (def.scope === 'protagonist' && isPlayer) || (def.scope === 'npc' && !isPlayer);
      case 'world': return def.scope === 'world';
      case 'place': return def.scope === 'place';
      case 'faction': return def.scope === 'faction';
      case 'item': return def.scope === 'item';
    }
  };
  return world.ruleset.states
    .filter(fits)
    .map((def) => {
      const own = stateDefFor(world, def.id, ownerId) ?? def;
      return fact(own, definite(ownerName), read(save.values, own, ownerId), isPlayer);
    })
    .filter(Boolean);
}

const note = (label: string, body: string) => `[ ${label}: ${body.replace(/\s*\n\s*/g, ' ').trim()} ]`;

// The notes for the latest turn: lore, the scene, the outcome. The player's words follow
// them as their own message.
export function momentFor(module: PraxisModule, save: Save, turn: Turn): string {
  const world = playable(module, save.local);
  const playerId = playerOf(world);
  const player = world.characters.find((character) => character.id === playerId);
  const place = placeOf(world, save, playerId);
  if (!place || !player) throw new Error('The save does not match its module.');
  const present = world.characters.filter((character) => character.id !== playerId && save.positions[character.id] === place.id);
  const things = thingsAt(world, save, place.id);
  const bearing = bearingOn(world, place, [player, ...present]);
  const ties = between(world, save, [player, ...present]);

  // Lore: slowest first. You, then the people here, what lies between them, the groups and
  // history bearing on the scene, then anything just named that is not here.
  const lore: string[] = [];
  const looks = typeof player.appearance === 'string' && player.appearance.trim() ? ` Looks: ${sentence(sentencesUpTo(player.appearance, 300))}` : '';
  lore.push(note('Lore', `You are ${midSentence(headOf(world, player))}.${player.description ? ` ${sentence(player.description)}` : ''}${looks}`));
  for (const profile of profiles(world, save, present)) lore.push(note('Lore', profile));
  for (const entry of ties.lore) lore.push(note('Lore', entry));
  for (const group of bearing.groups) lore.push(note('Lore', `${group.name}.${group.description ? ` ${sentence(group.description)}` : ''}`));
  for (const memory of bearing.memories) lore.push(note('Lore', `${memory.title}.${memory.description ? ` ${sentence(memory.description)}` : ''}`));
  const carried = thingsHeldBy(world, save, playerId);
  for (const thing of [...things, ...carried]) {
    if (thing.description?.trim()) lore.push(note('Lore', `${thing.name}. ${sentencesUpTo(thing.description, 300)}`));
  }
  const skip = new Set<string>([playerId, place.id, ...carried.map((thing) => thing.id), ...present.map((person) => person.id), ...things.map((thing) => thing.id), ...bearing.groups.map((group) => group.id), ...bearing.memories.map((memory) => memory.id)]);
  for (const entry of mentionedNotes(world, save, turn, skip)) lore.push(note('Lore', entry));

  // The scene: where you are, what it is like now, who is here doing what, what shows.
  const band = timeBandOf(calendarOf(world), save.clock);
  const scene: string[] = [];
  scene.push(`${placePath(world, place)}, ${band || 'now'}.`);
  if (place.description.trim()) scene.push(sentence(place.description));
  for (const character of present) {
    const doing = doingNow(world, save, character);
    scene.push(`${character.name} is here${doing ? `, ${doing.replace(/\.$/, '')}` : ''}.`);
  }
  if (!present.length) scene.push('Nobody else is here.');
  if (things.length) scene.push(`Also here: ${list(things.map((thing) => midSentence(thing.name)))}.`);
  if (carried.length) scene.push(`You carry ${list(carried.map((thing) => midSentence(thing.name)))}.`);
  // What shows. Whatever the outcome already says this turn is left to the outcome.
  const said = turn.directive ?? '';
  const shows = [
    ...statusOf(world, save, WORLD_OWNER, world.world.identity.name ?? world.world.name, 'world'),
    ...statusOf(world, save, playerId, player.name, 'character'),
    ...present.flatMap((character) => statusOf(world, save, character.id, character.name, 'character')),
    ...statusOf(world, save, place.id, place.name, 'place'),
    ...things.flatMap((thing) => statusOf(world, save, thing.id, thing.name, 'item')),
    ...bearing.groups.flatMap((group) => statusOf(world, save, group.id, group.name, 'faction')),
    ...ties.shows,
  ];
  scene.push(...shows.filter((entry) => !said.includes(entry)));
  const exits = exitsFrom(world, save.values, playerId, place.id);
  const open = exits.filter((exit) => !exit.blocked).map((exit) => midSentence(exit.place.name));
  const closed = exits.filter((exit) => exit.blocked).map((exit) => `The way to ${midSentence(exit.place.name)} is closed to you. ${sentence(exit.blocked ?? '')}`);
  if (open.length) scene.push(`From here you can go to ${list(open)}.`);
  scene.push(...closed);

  const notes = [...lore, note('Scene', scene.join(' '))];
  if (turn.directive) notes.push(note('Outcome', turn.directive));
  return notes.join('\n');
}

// --- The window.

export interface ContextBudget {
  total: number;
  reply: number;
  prefix: number;
  journal: number;
  moment: number;
  // The transcript cuts when it passes `transcriptHigh`, back to `transcriptLow`.
  transcriptHigh: number;
  transcriptLow: number;
}

export function budgetFor(module: PraxisModule, save: Save): ContextBudget {
  const world = playable(module, save.local);
  const options = save.options;
  const prefix = estimateTokens(systemPrefix(world, save), options.tokensPerChar);
  const high = Math.max(1000, options.contextTokens - options.replyTokens - options.journalTokens - MOMENT_RESERVE - prefix);
  const piece = Math.min(options.pieceTokens, Math.floor(high * 0.6));
  return { total: options.contextTokens, reply: options.replyTokens, prefix, journal: options.journalTokens, moment: MOMENT_RESERVE, transcriptHigh: high, transcriptLow: high - piece };
}

function turnTokens(turn: Turn, tokensPerChar: number): number {
  return estimateTokens(turn.input, tokensPerChar) + estimateTokens(turn.reply ?? '', tokensPerChar) + 6;
}

// Tokens for turns [start, end), with the opening when the window starts at the beginning.
export function spanTokens(module: PraxisModule, save: Save, start: number, end: number): number {
  const perChar = save.options.tokensPerChar;
  let total = start === 0 ? estimateTokens(module.scenario.opening.trim(), perChar) : 0;
  for (let index = start; index < end; index += 1) total += turnTokens(save.turns[index]!, perChar);
  return total;
}

// Where the window starts after a cut: the first start at which [start, end) fits in `low`.
function cutFrom(module: PraxisModule, save: Save, start: number, end: number, low: number): number {
  const perChar = save.options.tokensPerChar;
  let total = spanTokens(module, save, start, end);
  let at = start;
  while (total > low && at < end) {
    total -= turnTokens(save.turns[at]!, perChar) + (at === 0 ? estimateTokens(module.scenario.opening.trim(), perChar) : 0);
    at += 1;
  }
  return at;
}

// The window start for the latest turn: the previous turn's start, unless the turns since
// have pushed the transcript past its share, in which case a piece is cut.
export function windowStartFor(module: PraxisModule, save: Save): number {
  const count = save.turns.length;
  if (count <= 1) return 0;
  const end = count - 1;
  const previous = Math.min(save.turns[count - 2]!.windowStart ?? 0, end);
  const budget = budgetFor(module, save);
  if (spanTokens(module, save, previous, end) <= budget.transcriptHigh) return previous;
  return cutFrom(module, save, previous, end, budget.transcriptLow);
}

// Story about to leave the window that no journal entry covers yet: turns already outside
// it, or, once the transcript nears its cut, the turns the cut will take.
export function journalDue(module: PraxisModule, save: Save): { from: number; to: number } | null {
  if (save.journal.pending) return null;
  const count = save.turns.length;
  const latest = save.turns[count - 1];
  if (!latest || !latest.reply) return null;
  const covered = Math.min(save.journal.coveredTo, count);
  const start = Math.min(latest.windowStart ?? 0, count);
  if (covered < start) return { from: covered, to: start };
  const budget = budgetFor(module, save);
  if (spanTokens(module, save, start, count) < budget.transcriptHigh * 0.85) return null;
  const cut = cutFrom(module, save, start, count, budget.transcriptLow);
  return cut > covered ? { from: covered, to: cut } : null;
}

function pushMerged(messages: ChatMessage[], message: ChatMessage) {
  const last = messages[messages.length - 1];
  if (last && last.role === message.role && message.role !== 'system') last.content = `${last.content}\n\n${message.content}`;
  else messages.push({ ...message });
}

export interface ContextPlan {
  messages: ChatMessage[];
  // The first earlier turn included.
  start: number;
  budget: ContextBudget;
  estimate: { system: number; journal: number; transcript: number; moment: number; total: number };
  // Journal entries left out to stay in budget, and turns dropped past the window as a
  // last resort when the estimate was off.
  journalOmitted: number;
  trimmed: number;
}

// Messages for narrating the latest turn. Its own reply, if any, is left out, so the same
// call serves a first narration and a reroll.
export function contextPlan(module: PraxisModule, save: Save): ContextPlan {
  const world = playable(module, save.local);
  const count = save.turns.length;
  const turn = save.turns[count - 1];
  if (!turn) throw new Error('There is no turn to narrate.');
  const perChar = save.options.tokensPerChar;
  const budget = budgetFor(world, save);

  const prefix = systemPrefix(world, save);
  const journal = journalBlock(save.journal, save.options);
  const system = journal.text ? `${prefix}\n\n${journal.text}` : prefix;
  const notes = momentFor(world, save, turn);
  const moment = `${notes}\n\n${turn.input}`;

  const end = count - 1;
  let start = Math.min(turn.windowStart ?? 0, end);
  const room = save.options.contextTokens - save.options.replyTokens - estimateTokens(system, perChar) - estimateTokens(moment, perChar);
  let transcript = spanTokens(world, save, start, end);
  let trimmed = 0;
  while (transcript > room && start < end) {
    transcript -= turnTokens(save.turns[start]!, perChar) + (start === 0 ? estimateTokens(world.scenario.opening.trim(), perChar) : 0);
    start += 1;
    trimmed += 1;
  }

  const messages: ChatMessage[] = [{ role: 'system', content: system }];
  if (start === 0 && world.scenario.opening.trim()) pushMerged(messages, { role: 'assistant', content: world.scenario.opening.trim() });
  for (const past of save.turns.slice(start, end)) {
    pushMerged(messages, { role: 'user', content: past.input });
    if (past.reply) pushMerged(messages, { role: 'assistant', content: past.reply });
  }
  // The notes go in as their own message, so the player's turn holds only their words.
  messages.push({ role: 'system', content: notes });
  pushMerged(messages, { role: 'user', content: turn.input });

  const systemTokens = estimateTokens(prefix, perChar);
  const journalTokensUsed = estimateTokens(journal.text, perChar);
  const momentTokens = estimateTokens(moment, perChar);
  return {
    messages,
    start,
    budget,
    estimate: { system: systemTokens, journal: journalTokensUsed, transcript, moment: momentTokens, total: systemTokens + journalTokensUsed + transcript + momentTokens },
    journalOmitted: journal.omitted,
    trimmed,
  };
}

export function compileContext(module: PraxisModule, save: Save): ChatMessage[] {
  return contextPlan(module, save).messages;
}

// How many characters a set of messages comes to, for calibrating the token estimate
// against NovelAI's own count.
export function promptChars(messages: readonly ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + message.content.length + 16, 0);
}
