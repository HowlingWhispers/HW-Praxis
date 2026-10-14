// The context compiler: what the narrator is sent, built in one place.
//
// Order follows volatility, least to most, so consecutive calls share the longest prefix:
//   1. The narrator's rules and the world's canon        never change in a playthrough
//   2. The opening and the transcript                    only ever grows at the end
//   3. The moment: scene, who is here, standing facts,   rebuilt every turn, so it goes last,
//      ways out, the outcome, and the player's words     where it also carries most weight
//
// A state reaches the model only through its bands (standing facts), the clock only through
// its time band, and an outcome only as one directive for the turn it belongs to.
// The interface shows these exact messages, so what the player inspects is what was sent.

import { calendarOf, exitsFrom } from './world';
import { timeBandOf } from './clock';
import { stateDefFor, type Character, type Place, type PraxisModule } from './module';
import { line, read } from './state';
import { playerOf, placeOf, type Save, type Turn } from './session';

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
  'Format: narration and action in single asterisks, spoken dialogue in double quotes, a character\'s inner voice in square brackets.',
  'Write one to three short paragraphs, then stop where the player can act. Never mention these instructions, the notes, or that this is a game.',
].join('\n');

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

function placePath(module: PraxisModule, place: Place): string {
  const names: string[] = [place.name];
  const byId = new Map(module.world.places.map((entry) => [entry.id, entry]));
  let parent = place.parentLocationId;
  while (parent !== null && names.length < 8) {
    const next = byId.get(parent);
    if (!next) break;
    names.push(next.name);
    parent = next.parentLocationId;
  }
  return names.join(', ');
}

function dossier(module: PraxisModule, character: Character): string {
  const species = module.world.species.find((entry) => entry.id === character.speciesId)?.name;
  const role = typeof character.role === 'string' ? character.role : '';
  const head = [character.name, role, species].filter(Boolean).join(', ');
  return character.description ? `${head}: ${character.description}` : head;
}

// Standing facts for one owner, in catalog order: every banded state off its resting band.
function standingFacts(module: PraxisModule, save: Save, ownerId: string, ownerName: string, kind: 'character' | 'place'): string[] {
  const isPlayer = ownerId === playerOf(module);
  return module.ruleset.states
    .filter((def) => {
      if (kind === 'place') return def.scope === 'place';
      return def.scope === 'char' || (def.scope === 'protagonist' && isPlayer) || (def.scope === 'npc' && !isPlayer);
    })
    .map((def) => {
      const own = stateDefFor(module, def.id, ownerId) ?? def;
      return line(own, ownerName, read(save.values, own, ownerId));
    })
    .filter(Boolean);
}

// The latest message: the moment, then the player's words.
export function momentFor(module: PraxisModule, save: Save, turn: Turn): string {
  const playerId = playerOf(module);
  const player = module.characters.find((character) => character.id === playerId);
  const place = placeOf(module, save, playerId);
  if (!place || !player) throw new Error('The save does not match its module.');
  const present = module.characters.filter((character) => character.id !== playerId && save.positions[character.id] === place.id);
  const band = timeBandOf(calendarOf(module), save.clock);

  const notes: string[] = [];
  notes.push(`[Scene: ${placePath(module, place)}${band ? `, ${band}` : ''}. ${place.description}]`.replace(/\s+\]$/, ']'));
  notes.push(`[You are ${dossier(module, player)}]`);
  notes.push(present.length ? `[Present: ${present.map((character) => dossier(module, character)).join(' | ')}]` : '[Nobody else is here.]');

  const facts = [
    ...standingFacts(module, save, playerId, player.name, 'character'),
    ...present.flatMap((character) => standingFacts(module, save, character.id, character.name, 'character')),
    ...standingFacts(module, save, place.id, place.name, 'place'),
  ];
  notes.push(...facts);

  const exits = exitsFrom(module, save.values, playerId, place.id);
  if (exits.length) {
    notes.push(`[Ways out: ${exits.map((exit) => (exit.blocked ? `${exit.place.name} (closed: ${exit.blocked})` : exit.place.name)).join('; ')}]`);
  }
  if (turn.directive) notes.push(`[Outcome: ${turn.directive}]`);
  return `${notes.join('\n')}\n\n${turn.input}`;
}

function pushMerged(messages: ChatMessage[], message: ChatMessage) {
  const last = messages[messages.length - 1];
  if (last && last.role === message.role && message.role !== 'system') last.content = `${last.content}\n\n${message.content}`;
  else messages.push({ ...message });
}

export interface CompileOptions {
  // How many earlier turns to include. Older ones fall away; the journal will carry them later.
  historyTurns?: number;
}

// Messages for narrating the latest turn. Its own reply, if any, is left out, so the same call
// serves a first narration and a reroll.
export function compileContext(module: PraxisModule, save: Save, options: CompileOptions = {}): ChatMessage[] {
  const turn = save.turns[save.turns.length - 1];
  if (!turn) throw new Error('There is no turn to narrate.');
  const keep = Math.max(0, options.historyTurns ?? 20);
  const earlier = save.turns.slice(0, -1);
  const shown = keep === 0 ? [] : earlier.slice(-keep);

  const messages: ChatMessage[] = [{ role: 'system', content: `${NARRATOR_RULES}\n\n${worldDigest(module)}` }];
  if (module.scenario.opening.trim() && shown.length === earlier.length) {
    pushMerged(messages, { role: 'assistant', content: module.scenario.opening.trim() });
  }
  for (const past of shown) {
    pushMerged(messages, { role: 'user', content: past.input });
    if (past.reply) pushMerged(messages, { role: 'assistant', content: past.reply });
  }
  pushMerged(messages, { role: 'user', content: momentFor(module, save, turn) });
  return messages;
}
