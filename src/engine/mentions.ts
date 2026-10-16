// Mentioned records: the lorebook idea, applied to records.
//
// When a record is named in the player's words this turn or in the last two replies, and it
// is not already in the scene, the narrator gets a fuller note about it for that turn. The
// keys are the record's name, the name without its article, the parts of a person's proper
// name, and any `keys` the record lists (a Praxis field; Orbis keeps fields it does not know).
//
// Pure: text in, notes out. The notes go in the moment, never in the system part, because
// they change nearly every turn and the system part must stay the same between calls.

import type { Character, PraxisModule } from './module';
import type { Save, Turn } from './session';
import { estimateTokens } from './options';
import { bondBetween } from './relationships';

export type MentionKind = 'person' | 'place' | 'group' | 'species' | 'family' | 'memory' | 'thing' | 'lore';

export interface Mentionable {
  kind: MentionKind;
  id: string;
  keys: string[];
  note: () => string;
}

export const MENTION_TOKENS = 800;
const NOTE_CHARS = 420;
const KIND_ORDER: MentionKind[] = ['person', 'place', 'group', 'memory', 'lore', 'species', 'family', 'thing'];
const ARTICLE = /^(the|a|an)\s+/i;
// Words that start a proper name but say nothing on their own.
const WEAK = new Set(['the', 'and', 'of', 'old', 'young', 'lord', 'lady', 'sir', 'dame', 'master', 'mother', 'father', 'saint']);

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '').map((entry) => entry.trim()) : []);
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

// The first sentences of a text, up to about `chars` characters.
export function sentencesUpTo(source: string, chars: number): string {
  const clean = source.replace(/\s+/g, ' ').trim();
  if (clean.length <= chars) return clean;
  const sentences = clean.match(/[^.!?]+[.!?]+(?=\s|$)/g) ?? [clean];
  let out = '';
  for (const sentence of sentences) {
    if (out && out.length + sentence.length > chars) break;
    out += sentence;
  }
  return (out || clean.slice(0, chars)).trim();
}

// The words that call a record to mind.
export function keysFor(name: string, extra: unknown, options: { proper?: boolean; plural?: boolean } = {}): string[] {
  const keys = new Set<string>();
  const full = name.trim();
  if (full) keys.add(full);
  const bare = full.replace(ARTICLE, '');
  if (bare && bare !== full) keys.add(bare);
  if (options.proper && !ARTICLE.test(full)) {
    for (const part of full.split(/[\s,]+/)) {
      if (part.length >= 3 && /^\p{Lu}/u.test(part) && !WEAK.has(part.toLowerCase())) keys.add(part);
    }
  }
  if (options.plural && /s$/i.test(bare) && bare.length > 3) keys.add(bare.slice(0, -1));
  for (const key of strings(extra)) keys.add(key);
  return [...keys];
}

function matcher(keys: readonly string[]): RegExp | null {
  const usable = keys.filter((key) => key.length >= 3).map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'));
  if (!usable.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${usable.join('|')})(?![\\p{L}\\p{N}])`, 'iu');
}

const first = (value: unknown) => sentencesUpTo(text(value), NOTE_CHARS);

// Every record that can be mentioned, with how its note reads.
export function mentionables(world: PraxisModule, save: Save): Mentionable[] {
  const playerId = world.scenario.playerCharacterId;
  const places = new Map(world.world.places.map((place) => [place.id, place]));
  const speciesName = new Map(world.world.species.map((species) => [species.id, species.name]));
  const groupName = new Map([...world.world.factions, ...world.world.societies].map((group) => [group.id, group.name]));
  const personName = new Map(world.characters.map((character) => [character.id, character.name]));
  const out: Mentionable[] = [];

  for (const person of world.characters) {
    if (person.id === playerId) continue;
    // A role that is a title ("The Governor") names one person, so it calls them to mind too.
    const title = text(person.role).match(/^The\s+(.+)$/)?.[1];
    out.push({
      kind: 'person',
      id: person.id,
      keys: keysFor(person.name, [...strings(person.keys), ...(title ? [title] : [])], { proper: true }),
      note: () => personNote(world, save, person, places, speciesName, groupName),
    });
  }
  for (const place of world.world.places) {
    out.push({
      kind: 'place',
      id: place.id,
      keys: keysFor(place.name, place.keys),
      note: () => {
        const parent = place.parentLocationId ? places.get(place.parentLocationId)?.name : undefined;
        const kind = place.kind !== 'other' ? `${/^[aeiou]/i.test(place.kind) ? 'an' : 'a'} ${place.kind}` : '';
        const where = [kind, parent ? `in ${parent.replace(/^The /, 'the ')}` : ''].filter(Boolean).join(' ');
        return `${place.name}${where ? `, ${where}` : ''}${place.description ? `: ${first(place.description)}` : '.'}`;
      },
    });
  }
  for (const group of [...world.world.factions, ...world.world.societies]) {
    out.push({
      kind: 'group',
      id: group.id,
      keys: keysFor(group.name, group.keys),
      note: () => {
        const more = ['leadershipStructure', 'doctrine', 'customs', 'beliefs'].map((field) => sentencesUpTo(text(group[field]), 200)).filter(Boolean);
        return [`${group.name}${group.description ? `: ${first(group.description)}` : ''}`, ...more].join(' ');
      },
    });
  }
  for (const species of world.world.species) {
    if (!species.description) continue;
    out.push({ kind: 'species', id: species.id, keys: keysFor(species.name, species.keys, { plural: true }), note: () => `${species.name}: ${first(species.description)}` });
  }
  for (const family of world.world.families) {
    if (!family.description) continue;
    out.push({ kind: 'family', id: family.id, keys: keysFor(family.name, family.keys), note: () => `${family.name}: ${first(family.description)}` });
  }
  for (const memory of world.world.memories) {
    if (memory.origin === 'local') continue; // The player's notes are always sent.
    out.push({
      kind: 'memory',
      id: memory.id,
      keys: keysFor(memory.title, memory.keys),
      note: () => {
        const lasting = sentencesUpTo(text(memory.persistentEffects), 200);
        return `${memory.title}${memory.description ? `: ${first(memory.description)}` : ''}${lasting ? ` Lasting: ${lasting}` : ''}`;
      },
    });
  }
  for (const thing of world.items) {
    out.push({
      kind: 'thing',
      id: thing.id,
      keys: keysFor(thing.name, thing.keys),
      note: () => {
        const holder = text(thing.heldBy) ? personName.get(text(thing.heldBy)) : undefined;
        const at = text(thing.locationId) ? places.get(text(thing.locationId))?.name : undefined;
        const where = holder ? `, carried by ${holder === world.characters.find((character) => character.id === playerId)?.name ? 'you' : holder}` : at ? `, at ${at.replace(/^The /, 'the ')}` : '';
        return `${thing.name}${where}${thing.description ? `: ${first(thing.description)}` : ''}`;
      },
    });
  }
  // World lore beyond the facts that are always sent: a block named by its heading, or an
  // object with its own `keys` and `text`.
  for (const [heading, value] of Object.entries(world.world.lore)) {
    if (heading === 'importantFacts') continue;
    const words = heading.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    const body = typeof value === 'string' ? value : value && typeof value === 'object' ? text((value as Record<string, unknown>).text) || Object.values(value as Record<string, unknown>).filter((entry): entry is string => typeof entry === 'string').join(' ') : '';
    if (!body.trim()) continue;
    const keys = value && typeof value === 'object' ? strings((value as Record<string, unknown>).keys) : [];
    out.push({ kind: 'lore', id: `lore:${heading}`, keys: keys.length ? keys : [words], note: () => `${words.charAt(0).toUpperCase()}${words.slice(1)}: ${first(body)}` });
  }
  for (const [heading, value] of Object.entries(world.world.rules)) {
    if (heading === 'constraints' || typeof value !== 'string' || !value.trim()) continue;
    const words = heading.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    const keys = heading === 'magicPhysics' ? ['magic', 'spell', 'spells'] : heading === 'technology' ? ['technology', 'machine', 'machines'] : [words];
    out.push({ kind: 'lore', id: `rules:${heading}`, keys, note: () => `${words.charAt(0).toUpperCase()}${words.slice(1)}: ${first(value)}` });
  }
  return out;
}

function personNote(
  world: PraxisModule,
  save: Save,
  person: Character,
  places: Map<string, { name: string }>,
  speciesName: Map<string, string>,
  groupName: Map<string, string>,
): string {
  const role = text(person.role);
  const species = person.speciesId ? speciesName.get(person.speciesId) : undefined;
  const groups = person.factionIds.map((groupId) => groupName.get(groupId)).filter((name): name is string => Boolean(name)).map((name) => name.replace(/^The /, 'the '));
  const head = [person.name, role ? role.replace(/^(The|A|An) /, (word) => word.toLowerCase()) : '', species ? `of the ${species.replace(/^The /, '')}` : '', groups.length ? `member of ${groups.join(' and ')}` : ''].filter(Boolean).join(', ');
  const home = person.homeLocationId ? places.get(person.homeLocationId)?.name : undefined;
  const bond = bondBetween(world, save, world.scenario.playerCharacterId, person.id);
  const parts = [
    `${head}${person.description ? `: ${first(person.description)}` : '.'}`,
    home ? `Usually at ${home.replace(/^The /, 'the ')}, and not here now.` : 'Not here now.',
    bond?.tier ? `Between you: ${bond.tier}` : '',
  ];
  return parts.filter(Boolean).join(' ');
}

// The texts a mention is looked for in, newest first: the player's words this turn, then the
// replies to the two turns before it.
export function mentionSources(save: Save, turn: Turn): string[] {
  const index = save.turns.indexOf(turn);
  const before = index >= 0 ? save.turns.slice(0, index) : save.turns.slice(0, -1);
  const replies = before.slice(-2).reverse().map((entry) => entry.reply ?? '');
  return [turn.input, ...replies].filter((entry) => entry.trim() !== '');
}

// Notes for records named recently and not already in the scene, within the budget.
export function mentionedNotes(world: PraxisModule, save: Save, turn: Turn, skip: ReadonlySet<string>): string[] {
  const sources = mentionSources(save, turn);
  if (!sources.length) return [];
  const candidates = mentionables(world, save).filter((entry) => !skip.has(entry.id));
  const chosen: Mentionable[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const hits = candidates.filter((entry) => !seen.has(entry.id) && matcher(entry.keys)?.test(source));
    hits.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    for (const hit of hits) { seen.add(hit.id); chosen.push(hit); }
  }
  const notes: string[] = [];
  let used = 0;
  for (const entry of chosen) {
    const note = entry.note();
    const cost = estimateTokens(note, save.options.tokensPerChar) + 2;
    if (used + cost > MENTION_TOKENS) continue;
    used += cost;
    notes.push(note);
  }
  return notes;
}
