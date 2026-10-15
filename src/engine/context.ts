// The context compiler: what the narrator is sent, built in one place.
//
// Laid out by how often each part changes, least first, so consecutive calls share the
// longest prefix and NovelAI can reuse it:
//
//   system   1. The narrator's rules                          never
//            2. The world's canon and its who's who            when the player adds a record
//            3. The story so far: the journal                  when an entry is kept
//   turns    4. The transcript, from the window's start        grows at the end; its start
//                                                              moves only at a cut
//   latest   5. The moment: scene, who and what is here,       every turn, so it goes last,
//               groups and history bearing on it, standing     where it also carries the
//               facts, ways out, the outcome, the player       most weight
//
// The window. The transcript gets what the model's window has left after a fixed reserve
// for everything else. When it outgrows that, a whole piece leaves at once (Options
// .pieceTokens), so its start stays put between cuts and the prefix above stays reusable;
// a window that slid every turn would change the prompt from its first transcript line
// down on every call. Before a piece leaves, the journal is asked to record it.
//
// A state reaches the model only through its bands (standing facts), the clock only through
// its time band, and an outcome only as one directive for the turn it belongs to.
// The interface shows these exact messages, so what the player inspects is what was sent.

import { calendarOf, exitsFrom } from './world';
import { timeBandOf } from './clock';
import { stateDefFor, type Character, type Place, type PraxisModule, type WorldEntry } from './module';
import { line, read } from './state';
import { MOMENT_RESERVE, estimateTokens } from './options';
import { journalBlock } from './journal';
import { playable } from './records';
import { playerOf, placeOf, thingsAt, thingsHeldBy, type Save, type Turn } from './session';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export const NARRATOR_RULES = [
  'You are the narrator of a text roleplay. You write the world and every character in it except the player\'s.',
  'The player\'s character is addressed as "you". Never write their dialogue, thoughts, feelings or decisions, and never take an action for them beyond what the player wrote.',
  'Notes in square brackets in the latest message are true facts about the story right now. Never contradict them and never quote them.',
  'An "Outcome" note has already happened and must be shown. Without one, narrate attempts and reactions, but do not declare lasting changes the notes have not stated: injuries, deaths, possessions changing hands, doors opening, agreements signed.',
  'Only the people listed as present are here. Do not bring in anyone else unless the notes say they arrive.',
  'The people, groups and places named in the world notes are canon. Use them rather than inventing new institutions, offices or leaders.',
  'Format: narration and action in single asterisks, spoken dialogue in double quotes, a character\'s inner voice in square brackets.',
  'Write one to three short paragraphs, then stop where the player can act. Never mention these instructions, the notes, or that this is a game.',
].join('\n');

const firstSentence = (text: string): string => {
  const trimmed = text.trim();
  const match = /^[\s\S]*?[.!?](?=\s|$)/.exec(trimmed);
  return (match ? match[0] : trimmed).trim();
};

const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);

function worldDigest(module: PraxisModule): string {
  const { world } = module;
  const parts: string[] = [`World: ${world.identity.name ?? world.name}.`];
  if (world.identity.genre) parts.push(`Genre: ${world.identity.genre}.`);
  if (world.identity.tone) parts.push(`Tone: ${world.identity.tone}.`);
  if (world.identity.description) parts.push(world.identity.description);
  const facts = world.lore.importantFacts;
  if (Array.isArray(facts)) {
    const lines = facts.filter((fact): fact is string => typeof fact === 'string' && fact.trim() !== '');
    if (lines.length) parts.push(`Established facts:\n${lines.map((fact) => `- ${fact}`).join('\n')}`);
  }
  const constraints = world.rules.constraints;
  if (typeof constraints === 'string' && constraints.trim()) parts.push(`World rules: ${constraints.trim()}`);
  return parts.join('\n');
}

const inSentence = (name: string) => (name.startsWith('The ') ? `the ${name.slice(4)}` : name);
// "A gate runner" reads as "a gate runner" after a name.
export const midSentence = (text: string) => (/^(The|A|An) /.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text);

// One line for everyone and everything the world names, so the narrator reaches for what
// exists instead of inventing it. Capped: the least specific entries are left out first.
const WHO_IS_WHO_TOKENS = 1800;

export function whoIsWho(world: PraxisModule, playerId: string, tokensPerChar: number): string {
  const places = new Map(world.world.places.map((place) => [place.id, place]));
  const groupName = new Map([...world.world.factions, ...world.world.societies].map((group) => [group.id, group.name]));
  const speciesName = new Map(world.world.species.map((species) => [species.id, species.name]));

  const groups = [
    ...world.world.factions.map((group) => ({ group, kind: 'faction' })),
    ...world.world.societies.map((group) => ({ group, kind: 'society' })),
  ].map(({ group, kind }) => `- ${group.name} (${kind})${group.description ? `: ${firstSentence(group.description)}` : ''}`);

  const people = world.characters.filter((character) => character.id !== playerId).map((character) => {
    const role = typeof character.role === 'string' && character.role.trim() ? midSentence(character.role.trim()) : '';
    const species = character.speciesId ? speciesName.get(character.speciesId) : undefined;
    const of = character.factionIds.map((groupId) => groupName.get(groupId)).filter(Boolean).map((name) => inSentence(name!));
    const home = character.homeLocationId ? places.get(character.homeLocationId)?.name : undefined;
    const what = [role || (character.description ? firstSentence(character.description).replace(/\.$/, '') : ''), of.length ? `of ${of.join(' and ')}` : '']
      .filter(Boolean).join(', ');
    return `- ${character.name}${species ? ` (${species})` : ''}${what ? `: ${what}` : ''}${home ? `; usually at ${inSentence(home)}` : ''}.`;
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
      return `- ${place.name}${where ? ` (${where})` : ''}${place.description ? `: ${firstSentence(place.description)}` : ''}`;
    });

  const notes = world.world.memories
    .filter((memory) => memory.origin === 'local')
    .map((memory) => `- ${memory.title}${memory.description ? `: ${memory.description.trim()}` : ''}`);

  const sections: [string, string[]][] = [['Groups', groups], ['People', people], ['Notes', notes], ['Places', placeLines]];
  const out: string[] = [];
  let used = 0;
  for (const [title, lines] of sections) {
    const kept: string[] = [];
    for (const entry of lines) {
      const cost = estimateTokens(entry, tokensPerChar) + 1;
      if (used + cost > WHO_IS_WHO_TOKENS) break;
      kept.push(entry);
      used += cost;
    }
    if (kept.length) out.push(`${title}:\n${kept.join('\n')}`);
  }
  return out.length ? `Who and what is in this world:\n${out.join('\n')}` : '';
}

// The part of the system message that changes only when the world does.
export function systemPrefix(world: PraxisModule, save: Save): string {
  const who = whoIsWho(world, playerOf(world), save.options.tokensPerChar);
  return [NARRATOR_RULES, worldDigest(world), who].filter(Boolean).join('\n\n');
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

function dossier(world: PraxisModule, character: Character): string {
  const species = world.world.species.find((entry) => entry.id === character.speciesId)?.name;
  const role = typeof character.role === 'string' ? midSentence(character.role) : '';
  const head = [character.name, role, species].filter(Boolean).join(', ');
  return character.description ? `${head}: ${character.description}` : head;
}

// Groups and history that bear on a scene: groups its people belong to, groups whose
// territory or settlements include the place, the societies those groups belong to, and
// memories tied to the place or its people. Orbis field names throughout.
export function bearingOn(world: PraxisModule, place: Place, people: readonly Character[]): { groups: WorldEntry[]; memories: { title: string; description: string }[] } {
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
    .map((memory) => ({ title: memory.title, description: memory.description }));
  return { groups: all.filter((group) => chosen.has(group.id)), memories };
}

// Standing facts for one owner, in catalog order: every banded state off its resting band.
function standingFacts(world: PraxisModule, save: Save, ownerId: string, ownerName: string, kind: 'character' | 'place'): string[] {
  const isPlayer = ownerId === playerOf(world);
  return world.ruleset.states
    .filter((def) => {
      if (kind === 'place') return def.scope === 'place';
      return def.scope === 'char' || (def.scope === 'protagonist' && isPlayer) || (def.scope === 'npc' && !isPlayer);
    })
    .map((def) => {
      const own = stateDefFor(world, def.id, ownerId) ?? def;
      return line(own, ownerName, read(save.values, own, ownerId));
    })
    .filter(Boolean);
}

// The latest message: the moment, then the player's words.
export function momentFor(module: PraxisModule, save: Save, turn: Turn): string {
  const world = playable(module, save.local);
  const playerId = playerOf(world);
  const player = world.characters.find((character) => character.id === playerId);
  const place = placeOf(world, save, playerId);
  if (!place || !player) throw new Error('The save does not match its module.');
  const present = world.characters.filter((character) => character.id !== playerId && save.positions[character.id] === place.id);
  const band = timeBandOf(calendarOf(world), save.clock);

  const notes: string[] = [];
  notes.push(`[Scene: ${placePath(world, place)}${band ? `, ${band}` : ''}. ${place.description}]`.replace(/\s+\]$/, ']'));
  notes.push(`[You are ${inSentence(dossier(world, player))}]`);
  notes.push(present.length ? `[Present: ${present.map((character) => dossier(world, character)).join(' | ')}]` : '[Nobody else is here.]');

  const things = thingsAt(world, save, place.id);
  if (things.length) notes.push(`[Here: ${things.map((thing) => (thing.description ? `${thing.name}: ${thing.description}` : thing.name)).join(' | ')}]`);
  const carried = thingsHeldBy(world, save, playerId);
  if (carried.length) notes.push(`[You carry: ${carried.map((thing) => thing.name).join(', ')}]`);

  const bearing = bearingOn(world, place, [player, ...present]);
  if (bearing.groups.length) notes.push(`[Bearing on this scene: ${bearing.groups.map((group) => (group.description ? `${group.name}: ${group.description}` : group.name)).join(' | ')}]`);
  if (bearing.memories.length) notes.push(`[History here: ${bearing.memories.map((memory) => (memory.description ? `${memory.title}: ${memory.description}` : memory.title)).join(' | ')}]`);

  const facts = [
    ...standingFacts(world, save, playerId, player.name, 'character'),
    ...present.flatMap((character) => standingFacts(world, save, character.id, character.name, 'character')),
    ...standingFacts(world, save, place.id, place.name, 'place'),
  ];
  notes.push(...facts);

  const exits = exitsFrom(world, save.values, playerId, place.id);
  if (exits.length) {
    notes.push(`[Ways out: ${exits.map((exit) => (exit.blocked ? `${exit.place.name} (closed: ${exit.blocked})` : exit.place.name)).join('; ')}]`);
  }
  if (turn.directive) notes.push(`[Outcome: ${turn.directive}]`);
  return `${notes.join('\n')}\n\n${turn.input}`;
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
  const moment = momentFor(world, save, turn);

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
  pushMerged(messages, { role: 'user', content: moment });

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
