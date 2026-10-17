// The context compiler: what the narrator is sent, built in one place.
//
// Every part has one home, and the parts run from what never changes to what changes every
// turn, the way NovelAI lays out a story: Memory, then the lorebook, then the story, with
// the newest guidance last.
//
//   system      Directions: how to narrate, the house format shown    never changes
//               by example, and the world (identity, facts, rules,
//               the land's top regions)
//   system      The lorebook section, slowest first:                  when a journal entry is
//                 the story so far (the journal)                       kept, or the scene
//                 you, and your own notes                              changes: you travel,
//                 where you are: the place, its history, the ways on   someone comes or goes,
//                 who is present and what they are doing               or something new is
//                 what lies between the people here                    named
//                 lore switched on by key since the scene began
//   transcript  Earlier turns: your words and the narrator's replies.   never rewritten
//               Once resolved, only the story remains: no rolls
//   user        Your words this turn, alone                           every turn
//   prefill     The start of the reply, as NovelAI writes it: what    every turn
//               the narrator will do this turn, what the rules
//               decided, and every condition that must stay true,
//               then "[Of course, here you go:]" and an opening *
//
// Nothing is said twice. Someone present appears up to three times, each with a different
// job: the dramatis personae says they are here and what they are doing, their lore entry
// says who they are, and the prefill keeps their condition. Their description's first
// sentence rides on the dramatis personae only while their lore entry is off.
//
// The window. The transcript gets what the model's window has left after a fixed reserve for
// everything else. When it outgrows that, a whole piece leaves at once (Options.pieceTokens),
// so its start stays put between cuts and everything above it stays reusable. Before a piece
// leaves, the journal is asked to record it.
//
// A state reaches the model only through its bands, in words, and only off its resting band;
// the clock only through its time band. The interface shows these exact messages and the
// prefill, so what the player inspects is what was sent.

import { calendarOf, exitsFrom } from './world';
import { timeBandOf } from './clock';
import { stateDefFor, type Character, type Place, type PraxisModule, type WorldEntry } from './module';
import { fact, pairKey, read, WORLD_OWNER, type StateDef } from './state';
import { LORE_TOKENS, loreActivations, mentionables, sentencesUpTo } from './mentions';
import { doingNow, dueElsewhere } from './schedule';
import { followingAs } from './follow';
import { pairName } from './relationships';
import { MOMENT_RESERVE, estimateTokens } from './options';
import { journalBlock } from './journal';
import { playable } from './records';
import { playerOf, placeOf, thingsAt, thingsHeldBy, type Save, type Turn } from './session';
import { capital, definite, listOf as list, midSentence, pronounsOf, sentence } from './words';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// The narrator's standing instructions: brief, and in what-to-do terms, since a rule phrased
// as "never X" tends to put X in the model's mind.
export function narratorRules(playerName: string): string {
  const player = playerName.replace(/^(The|A|An) /, (word) => word.toLowerCase());
  return [
    `You narrate a text adventure. The player is ${player}, written as "you". You play the world and everyone else in it.`,
    '- Write only the next beat. Show how the world answers what the player just did, then stop where they can act again.',
    `- Leave what ${player} says, does, thinks and feels to the player.`,
    '- Notes in [square brackets] are outside the story, from the game or the player, and they are true. Use what they say in your own words, and keep the notes themselves out of the story.',
    '- What the rules decided is final. When your reply opens by saying what to show, show exactly that, and let it carry into what everyone does next. When nothing was decided, show the attempt and leave the result open.',
    '- Only the people listed as present are here. Anyone else stays offstage until they arrive.',
    '- Write in second person, present tense, in concrete detail that can be seen, heard, smelled and touched. One to three short paragraphs.',
    '- Narration and action go in *asterisks*. Speech is plain text, with no quotation marks. Thoughts go in (parentheses), and no one else hears them.',
  ].join('\n');
}

// The format, shown rather than told: the model copies what it sees. A different story, so
// none of it leaks into this one, with a thought nobody hears and a reply that stops where
// the player can act.
export const FORMAT_EXAMPLE = [
  'An example of the format, from another story:',
  'You: Evening. *I set two coins on the rail.* That should cover the toll. (He looks like he would take the coat off my back.)',
  'Narrator: *The tollkeeper sweeps the coins off the rail without counting them. Rain runs from the brim of his hat.* Two for a man on foot. *His eyes go to the mule behind you, then back to your face. His hand stays on the bar.* The mule is another two. Most pay it.',
  'You: *I ask the ferryman how deep the river runs here.*',
  'Narrator: *He leans on his pole and spits over the side. The ferry swings a little in the current.* Deep enough to keep what it takes.',
].join('\n');

const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);
const inSentence = (name: string) => (name.startsWith('The ') ? `the ${name.slice(4)}` : name);
const firstOf = (text: string | undefined, chars = 200) => (text?.trim() ? sentence(sentencesUpTo(text, chars)) : '');

function depthOf(places: Map<string, Place>, place: Place): number {
  let depth = 0;
  let parent = place.parentLocationId;
  while (parent !== null && depth < 20) { depth += 1; parent = places.get(parent)?.parentLocationId ?? null; }
  return depth;
}

// The land at a glance: the top two levels of places, one line each, capped. Deeper places
// arrive as the lore of where you are, or by name.
const LAND_TOKENS = 500;

function theLand(world: PraxisModule, tokensPerChar: number): string {
  const places = new Map(world.world.places.map((place) => [place.id, place]));
  const lines: string[] = [];
  let used = 0;
  for (const place of world.world.places.filter((entry) => depthOf(places, entry) <= 1).sort((a, b) => depthOf(places, a) - depthOf(places, b))) {
    const parent = place.parentLocationId ? places.get(place.parentLocationId)?.name : undefined;
    const line = `- ${place.name}${parent ? `, in ${parent}` : ''}${place.description ? `: ${firstOf(place.description)}` : ''}`;
    const cost = estimateTokens(line, tokensPerChar) + 1;
    if (used + cost > LAND_TOKENS) break;
    lines.push(line);
    used += cost;
  }
  return lines.length ? `The land:\n${lines.join('\n')}` : '';
}

function worldDigest(module: PraxisModule, tokensPerChar: number): string {
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
  const land = theLand(module, tokensPerChar);
  if (land) parts.push(land);
  return parts.join('\n');
}

// The first system message: the same for the whole story.
export function systemPrefix(world: PraxisModule, save: Save): string {
  const playerId = playerOf(world);
  const player = world.characters.find((character) => character.id === playerId)?.name ?? 'the player character';
  return [narratorRules(player), FORMAT_EXAMPLE, worldDigest(world, save.options.tokensPerChar)].join('\n\n');
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

// Someone present, in full: who they are, how they look, carry themselves and speak.
const DOSSIER_CHARS = 420;

function profile(world: PraxisModule, character: Character): string {
  const extras = ([['Looks', character.appearance], ['Manner', character.personality], ['Speech', character.speech]] as const)
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .map(([label, value]) => `${label}: ${sentence(sentencesUpTo(value as string, DOSSIER_CHARS))}`);
  return `${headOf(world, character)}: ${[sentence(character.description ?? ''), ...extras].filter(Boolean).join(' ')}`;
}

// Groups and history that bear on a scene: groups its people belong to, groups whose
// territory or settlements include the place, the societies those groups belong to, and
// memories tied to the place or its people. Orbis field names throughout. The play screen
// marks these groups; the narrator hears of a group when it is named.
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

// What lies between people who are both here, the player included: the relationship, what
// each wants, and where the bond stands now.
function between(world: PraxisModule, save: Save, people: readonly Character[]): string[] {
  const playerId = playerOf(world);
  const here = new Set(people.map((person) => person.id));
  const out: string[] = [];
  for (const relationship of world.relationships) {
    if (!relationship.personIds.every((personId) => here.has(personId))) continue;
    const owner = pairKey(...relationship.personIds);
    const wants = Object.entries(relationship.wants)
      .filter(([personId, want]) => personId !== playerId && want.trim())
      .map(([personId, want]) => `${definite(world.characters.find((character) => character.id === personId)?.name ?? personId)} wants ${midSentence(want.trim()).replace(/\.$/, '')}.`);
    const def = relationship.bondStateId ? stateDefFor(world, relationship.bondStateId, owner) : undefined;
    const tier = def ? fact({ ...def, line: '[|bandLabel|]' }, '', read(save.values, def, owner), false, true) : '';
    const parts = [sentence(relationship.shape), relationship.together.trim() ? `Together: ${sentence(relationship.together)}` : '', ...wants, tier ? `Now: ${sentence(tier)}` : ''].filter(Boolean);
    if (parts.length) out.push(`${pairOf(world, owner, playerId)}: ${parts.join(' ')}`);
  }
  return out;
}

type FactOwner = 'world' | 'character' | 'place' | 'faction' | 'item';

// What shows about one owner, in catalog order: every banded state off its resting band, in
// words that say what it means: "You are hurt: it slows you.", "The garrison guard has given
// way: they believe you, …"
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
      const person = kind === 'character' ? world.characters.find((character) => character.id === ownerId) : undefined;
      const who = person ? pronounsOf(person.pronouns) : kind === 'item' ? pronounsOf('it') : undefined;
      return fact(own, definite(ownerName), read(save.values, own, ownerId), isPlayer, false, who);
    })
    .filter(Boolean);
}

const note = (body: string) => `[ ${body.replace(/\s*\n\s*/g, ' ').trim()} ]`;

interface Scene {
  world: PraxisModule;
  playerId: string;
  player: Character;
  place: Place;
  present: Character[];
}

function sceneFor(module: PraxisModule, save: Save): Scene {
  const world = playable(module, save.local);
  const playerId = playerOf(world);
  const player = world.characters.find((character) => character.id === playerId);
  const place = placeOf(world, save, playerId);
  if (!place || !player) throw new Error('The save does not match its module.');
  const present = world.characters.filter((character) => character.id !== playerId && save.positions[character.id] === place.id);
  return { world, playerId, player, place, present };
}

// The lorebook section for the latest turn, without the journal.
export function loreFor(module: PraxisModule, save: Save, turn: Turn): string {
  const { world, playerId, player, place, present } = sceneFor(module, save);
  const out: string[] = [];

  // You, always.
  const carried = thingsHeldBy(world, save, playerId);
  const looks = typeof player.appearance === 'string' && player.appearance.trim() ? `Looks: ${sentence(sentencesUpTo(player.appearance, 300))}` : '';
  const carrying = carried.length ? `You carry ${list(carried.map((thing) => midSentence(thing.name)))}.` : '';
  out.push(note(`You are ${midSentence(headOf(world, player))}: ${[sentence(player.description ?? ''), looks, carrying].filter(Boolean).join(' ')}`));
  // Your own notes, always.
  for (const memory of world.world.memories.filter((entry) => entry.origin === 'local')) {
    out.push(note(`Your note, ${memory.title}${memory.description ? `: ${memory.description.trim()}` : ''}`));
  }

  // Where you are, while you are there: the place, the places it lies in below the land's
  // top levels, its history, what is lying here, and the ways on.
  const places = new Map(world.world.places.map((entry) => [entry.id, entry]));
  const chain = ancestry(world, place).slice(1).map((placeId) => places.get(placeId)).filter((entry): entry is Place => Boolean(entry));
  const within = chain.filter((entry) => depthOf(places, entry) > 1 && entry.description).map((entry) => `${entry.name}: ${firstOf(entry.description)}`);
  const history = bearingOn(world, place, []).memories.map((memory) => `${memory.title}: ${firstOf(memory.description, 300)}`);
  const things = thingsAt(world, save, place.id);
  const exits = exitsFrom(world, save.values, playerId, place.id);
  const open = exits.filter((exit) => !exit.blocked).map((exit) => midSentence(exit.place.name));
  const closed = exits.filter((exit) => exit.blocked).map((exit) => `The way to ${midSentence(exit.place.name)} is closed to you. ${sentence(exit.blocked ?? '')}`);
  out.push(note([
    `${[place.name, ...chain.map((entry) => entry.name)].join(', ')}: ${sentence(place.description)}`,
    ...within,
    ...history,
    things.length ? `Also here: ${list(things.map((thing) => midSentence(thing.name)))}.` : '',
    open.length ? `Ways on: ${list(open)}.` : '',
    ...closed,
  ].filter(Boolean).join(' ')));

  // Lore switched on by key since the scene began. Present people come first in the budget;
  // the rest by how recently they came up. Shown in the order they first came up.
  const presentIds = new Set(present.map((person) => person.id));
  // Not again: you, where you are and the places it lies in, and the land's top levels,
  // which the first message already gives.
  const skip = new Set<string>([playerId, ...ancestry(world, place), ...world.world.places.filter((entry) => depthOf(places, entry) <= 1).map((entry) => entry.id)]);
  const activations = loreActivations(world, save, turn, presentIds, skip);
  const notes = new Map(mentionables(world, save).map((entry) => [entry.id, entry]));
  const textFor = (id: string) => {
    const here = present.find((person) => person.id === id);
    return here ? profile(world, here) : notes.get(id)?.note() ?? '';
  };
  const ranked = [...activations].sort((a, b) => Number(presentIds.has(b.id)) - Number(presentIds.has(a.id)) || b.last - a.last);
  const kept = new Set<string>();
  let used = 0;
  for (const activation of ranked) {
    const cost = estimateTokens(textFor(activation.id), save.options.tokensPerChar) + 2;
    if (used + cost > LORE_TOKENS) continue;
    used += cost;
    kept.add(activation.id);
  }

  // The dramatis personae: who is here and what they are doing, with their first line only
  // while their lore is off.
  const band = timeBandOf(calendarOf(world), save.clock) || 'now';
  const cast = present.map((person) => {
    const as = followingAs(world, save, person.id);
    const due = as ? '' : dueElsewhere(world, save, person);
    const doing = as ? '' : doingNow(world, save, person);
    const role = typeof person.role === 'string' && person.role.trim() ? midSentence(person.role.trim()) : '';
    const state = as || (due ? `due at ${inSentence(due)} by now` : doing.replace(/\.$/, ''));
    const line = kept.has(person.id) ? '' : firstOf(person.description);
    return `${[person.name, role, state].filter(Boolean).join(', ')}${line ? `: ${line}` : '.'}`;
  });
  out.push(note(`Present at ${inSentence(place.name)}, ${band}: ${cast.length ? cast.join(' ') : 'nobody but you.'}`));
  for (const entry of between(world, save, [player, ...present])) out.push(note(entry));
  for (const activation of activations) if (kept.has(activation.id)) out.push(note(textFor(activation.id)));
  return out.join('\n');
}

// Every condition that must stay true this turn: the world's, yours, the people here, the
// place and the things in it. Whatever this turn's outcome already says is left to it.
export function standingFor(module: PraxisModule, save: Save, turn: Turn): string[] {
  const { world, playerId, player, place, present } = sceneFor(module, save);
  const said = turn.directive ?? '';
  return [
    ...statusOf(world, save, WORLD_OWNER, world.world.identity.name ?? world.world.name, 'world'),
    ...statusOf(world, save, playerId, player.name, 'character'),
    ...present.flatMap((person) => statusOf(world, save, person.id, person.name, 'character')),
    ...statusOf(world, save, place.id, place.name, 'place'),
    ...thingsAt(world, save, place.id).flatMap((thing) => statusOf(world, save, thing.id, thing.name, 'item')),
  ].filter((entry) => !said.includes(entry));
}

// The start of the reply, as NovelAI writes it for its own models: the narrator says what it
// will do, then the story begins. Closest to where the reply is written, so it carries the
// most weight, and written as clean sentences, since whatever it looks like, the reply copies.
export const PREFILL_MARK = '[Of course, here you go:]';
export const REPLY_START = '*';

// "It works." reads "it works" after "Show that"; a name keeps its capital.
const LEADS = /^(It|The|A|An|You|Your|Something|Time|Even|This|That|Everyone|Nothing|Meanwhile|Whatever|One|There|He|She|They|His|Her|Their|We|Our)\b/;
const lowerLead = (text: string) => (LEADS.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text);
const ended = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

export function prefillFor(module: PraxisModule, save: Save, turn: Turn): string {
  const standing = standingFor(module, save, turn);
  const decided = (turn.directive ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
  const lines = [
    'Understood. I will:',
    '- Continue the text adventure in the established voice, in second person and present tense, with narration and action in *asterisks*, speech as plain text, and thoughts in (parentheses).',
    ...(decided.length ? decided.map((line) => `- Show that ${ended(lowerLead(line))}`) : ['- Show how the world answers what you just did, and leave the outcome of anything uncertain open.']),
    ...standing.map((entry) => `- Remember that ${ended(lowerLead(entry))}`),
    '- Stop where you can act again.',
    PREFILL_MARK,
  ];
  return `${lines.join('\n')}\n${REPLY_START}`;
}

// A past turn as the transcript keeps it: once a turn is resolved, only the story remains.
function pastInput(turn: Turn): string {
  return turn.input;
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
  return estimateTokens(pastInput(turn), tokensPerChar) + estimateTokens(turn.reply ?? '', tokensPerChar) + 6;
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
  // The start of the reply, sent after the messages. The narration that comes back continues
  // it; `replyStart` (the opening *) is put back in front of it.
  prefill: string;
  replyStart: string;
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

  const system = systemPrefix(world, save);
  const journal = journalBlock(save.journal, save.options);
  const lore = loreFor(world, save, turn);
  const prefill = prefillFor(world, save, turn);
  const loreMessage = [journal.text, lore].filter(Boolean).join('\n\n');

  const end = count - 1;
  let start = Math.min(turn.windowStart ?? 0, end);
  const fixed = estimateTokens(system, perChar) + estimateTokens(loreMessage, perChar) + estimateTokens(turn.input, perChar) + estimateTokens(prefill, perChar);
  const room = save.options.contextTokens - save.options.replyTokens - fixed;
  let transcript = spanTokens(world, save, start, end);
  let trimmed = 0;
  while (transcript > room && start < end) {
    transcript -= turnTokens(save.turns[start]!, perChar) + (start === 0 ? estimateTokens(world.scenario.opening.trim(), perChar) : 0);
    start += 1;
    trimmed += 1;
  }

  const messages: ChatMessage[] = [{ role: 'system', content: system }, { role: 'system', content: loreMessage }];
  if (start === 0 && world.scenario.opening.trim()) pushMerged(messages, { role: 'assistant', content: world.scenario.opening.trim() });
  for (const past of save.turns.slice(start, end)) {
    pushMerged(messages, { role: 'user', content: pastInput(past) });
    if (past.reply) pushMerged(messages, { role: 'assistant', content: past.reply });
  }
  pushMerged(messages, { role: 'user', content: turn.input });

  const systemTokens = estimateTokens(system, perChar);
  const journalTokensUsed = estimateTokens(journal.text, perChar);
  const momentTokens = estimateTokens(lore, perChar) + estimateTokens(turn.input, perChar) + estimateTokens(prefill, perChar);
  return {
    messages,
    prefill,
    replyStart: REPLY_START,
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

// How many characters a set of messages and the prefill come to, for calibrating the token
// estimate against NovelAI's own count.
export function promptChars(messages: readonly ChatMessage[], prefill = ''): number {
  return messages.reduce((sum, message) => sum + message.content.length + 16, 0) + prefill.length;
}

// The reply as the player reads it: the opening the prefill gave, then what came back. When
// the narrator was continuing a reply the player edited, the two join exactly as written.
export function replyFrom(plan: Pick<ContextPlan, 'replyStart'>, text: string): string {
  if (plan.replyStart.length > REPLY_START.length) {
    // The edit was sent without trailing space; the continuation brings its own.
    const body = text.replace(/\s+$/, '');
    return /^[\s.,;:!?'’)*]/.test(body) || !body ? `${plan.replyStart}${body}` : `${plan.replyStart} ${body}`;
  }
  const body = text.replace(/^\s+/, '');
  if (!plan.replyStart || body.startsWith(plan.replyStart)) return body;
  return `${plan.replyStart}${body}`;
}

// Who each message is from, in the player's terms.
export function sentAs(role: ChatMessage['role'], index: number): string {
  if (role === 'system') return index === 0 ? 'Instructions and world · system' : 'Story so far and lore · system';
  return role === 'user' ? 'You · user' : 'Narrator · assistant';
}

// Everything the narrator was sent, as one text to copy or save, with the replies that came
// back for it, so a turn can be looked at whole.
export function planAsText(plan: Pick<ContextPlan, 'messages' | 'prefill'>, replies: readonly string[] = []): string {
  const parts = plan.messages.map((message, index) => `=== ${sentAs(message.role, index)} ===\n${message.content}`);
  if (plan.prefill) parts.push(`=== The reply's opening · prefill ===\n${plan.prefill}`);
  replies.forEach((reply, index) => parts.push(`=== Reply ${index + 1} of ${replies.length} ===\n${reply}`));
  return `${parts.join('\n\n')}\n`;
}

// The same call, asked to carry on from a reply the player edited up to a point: the edit
// becomes the start of the reply, after the narrator's opening.
export function continuing(plan: ContextPlan, partial: string): ContextPlan {
  const head = plan.prefill.slice(0, plan.prefill.length - plan.replyStart.length);
  // A prompt that ends in a space reads badly to the model, which writes its own.
  const start = partial.replace(/\s+$/, '');
  return { ...plan, prefill: `${head}${start}`, replyStart: start };
}
