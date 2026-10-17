// Key-activated lore: NovelAI's lorebook idea, applied to records.
//
// A record's lore joins the narrator's lorebook section once it is named in the story of the
// current scene: your words or a reply since you arrived where you are (or the opening, before
// you have gone anywhere). It stays until you leave, so someone who goes quiet keeps their
// profile, and the section changes only when something new comes up. The keys are the
// record's name, the name without its article, the parts of a person's proper name, a title
// role, any `keys` the record lists, and, for someone here whose name starts with an article,
// its last word ("guard" for "A garrison guard"). Being the target of a check counts too.
//
// Only the story is scanned, with what the rules decided each turn, never the game's other
// notes: the dramatis personae names everyone present, and scanning it would switch them all on.

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

const NOTE_CHARS = 420;
const KIND_ORDER: MentionKind[] = ['person', 'place', 'group', 'memory', 'lore', 'species', 'family', 'thing'];
export const LORE_TOKENS = 1800;
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

function matcher(keys: readonly string[], flags = ''): RegExp | null {
  const usable = keys.filter((key) => key.length >= 3).sort((a, b) => b.length - a.length).map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'));
  if (!usable.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${usable.join('|')})(?![\\p{L}\\p{N}])`, `iu${flags}`);
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

// Where the current scene began: the latest turn that moved you, whose reply is the arrival,
// or the start of the story.
export function sceneStartOf(save: Save, playerId: string): number {
  const turns = save.turns;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const before = turns[index]!.before.positions[playerId];
    const after = index + 1 < turns.length ? turns[index + 1]!.before.positions[playerId] : save.positions[playerId];
    if (before !== after) return index;
  }
  return 0;
}

export interface Activation {
  id: string;
  kind: MentionKind;
  // Positions in the scene's story text: the opening is -1, turn i's words 2i, its reply 2i + 1.
  first: number;
  last: number;
}

// Everything named in the current scene so far, in the order it first came up.
export function loreActivations(world: PraxisModule, save: Save, turn: Turn, presentIds: ReadonlySet<string>, skip: ReadonlySet<string>): Activation[] {
  const playerId = world.scenario.playerCharacterId;
  const index = save.turns.indexOf(turn);
  const upTo = index >= 0 ? index : save.turns.length - 1;
  const start = Math.min(sceneStartOf(save, playerId), upTo);
  const sources: { at: number; text: string }[] = [];
  const targets: { at: number; owner: string }[] = [];
  if (start === 0 && world.scenario.opening.trim()) sources.push({ at: -1, text: world.scenario.opening });
  for (let at = start; at <= upTo; at += 1) {
    const entry = save.turns[at]!;
    sources.push({ at: 2 * at, text: entry.input });
    // What the rules decided names people too: "Meanwhile, Ines Corvo arrives."
    if (entry.directive) sources.push({ at: 2 * at, text: entry.directive });
    if (entry.check) targets.push({ at: 2 * at, owner: entry.check.target.owner });
    if (at < upTo && entry.reply) sources.push({ at: 2 * at + 1, text: entry.reply });
  }
  const found = new Map<string, Activation>();
  const note = (id: string, kind: MentionKind, at: number) => {
    const known = found.get(id);
    if (known) known.last = Math.max(known.last, at);
    else found.set(id, { id, kind, first: at, last: at });
  };
  const candidates = mentionables(world, save)
    .filter((entry) => !skip.has(entry.id) && entry.id !== playerId)
    .map((entry) => {
      const name = entry.kind === 'person' ? world.characters.find((character) => character.id === entry.id)?.name ?? '' : '';
      const head = presentIds.has(entry.id) && ARTICLE.test(name) ? name.trim().split(/\s+/).at(-1) ?? '' : '';
      return { entry, test: matcher(head ? [...entry.keys, head] : entry.keys, 'g') };
    });
  for (const source of sources) {
    // Every match, then only those no longer match of something else overlaps: "The
    // garrison" in "The garrison guard" is the guard, not the garrison.
    const spans: { id: string; kind: MentionKind; from: number; to: number }[] = [];
    for (const { entry, test } of candidates) {
      if (!test) continue;
      for (const match of source.text.matchAll(test)) spans.push({ id: entry.id, kind: entry.kind, from: match.index, to: match.index + match[0].length });
    }
    for (const span of spans) {
      const beaten = spans.some((other) => other.id !== span.id && other.from < span.to && span.from < other.to && other.to - other.from > span.to - span.from);
      if (!beaten) note(span.id, span.kind, source.at);
    }
  }
  for (const target of targets) {
    if (skip.has(target.owner) || target.owner === playerId) continue;
    const person = world.characters.some((character) => character.id === target.owner);
    if (person || world.items.some((item) => item.id === target.owner)) note(target.owner, person ? 'person' : 'thing', target.at);
  }
  return [...found.values()].sort((a, b) => a.first - b.first || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

// The note a mention gives, by id: what the lorebook section shows for an absent record.
export function mentionNote(world: PraxisModule, save: Save, id: string): string {
  return mentionables(world, save).find((entry) => entry.id === id)?.note() ?? '';
}
