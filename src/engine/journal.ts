// The journal: the story so far, kept so the narrator remembers what has left the window.
//
// Character Engine's shape. Entries are the record; the active ones are sent with every
// turn, archived ones are kept and never sent. The player can write anything. When story is
// about to leave the window, Praxis asks the model for a short entry covering it, and when
// the journal outgrows its budget, for a compressed version of the oldest entries. Both
// arrive as a pending suggestion: nothing joins the journal until the player keeps it.
//
// Ids and the story clock are passed in, so this stays deterministic.

import { z } from 'zod';
import { estimateTokens, type Options } from './options';
import { playable } from './records';
import type { ChatMessage } from './context';
import type { PraxisModule } from './module';
import type { Save } from './session';

const id = z.string().min(1).max(200);
const index = z.number().int().nonnegative();

export const journalEntrySchema = z.object({
  id,
  text: z.string().min(1).max(8000),
  // The story minute it belongs to.
  storyT: z.number().int().nonnegative(),
  source: z.enum(['player', 'suggested', 'compressed']),
  archived: z.boolean().default(false),
  // The turns a suggested entry records, [from, to).
  turns: z.object({ from: index, to: index }).optional(),
  // The entries a compressed one replaced. They are archived, not deleted.
  merged: z.array(id).max(500).optional(),
});

export const pendingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('entry'), from: index, to: index, text: z.string().max(8000) }),
  z.object({ kind: z.literal('compress'), entryIds: z.array(id).min(2).max(500), text: z.string().max(8000) }),
]);

export const journalSchema = z.object({
  entries: z.array(journalEntrySchema).max(10_000).default([]),
  // Turns before this index are in the journal, or the player passed over them.
  coveredTo: index.default(0),
  pending: pendingSchema.nullable().default(null),
  // How many entries were active when a compression was last declined. It is not
  // suggested again until there are more.
  compressDeclinedAt: index.default(0),
});

export type JournalEntry = z.infer<typeof journalEntrySchema>;
export type Pending = z.infer<typeof pendingSchema>;
export type Journal = z.infer<typeof journalSchema>;

export function emptyJournal(): Journal {
  return { entries: [], coveredTo: 0, pending: null, compressDeclinedAt: 0 };
}

// Story order: by story time, then by when they were written.
export function activeEntries(journal: Journal): JournalEntry[] {
  return journal.entries
    .map((entry, position) => ({ entry, position }))
    .filter(({ entry }) => !entry.archived)
    .sort((a, b) => a.entry.storyT - b.entry.storyT || a.position - b.position)
    .map(({ entry }) => entry);
}

export function archivedEntries(journal: Journal): JournalEntry[] {
  return journal.entries.filter((entry) => entry.archived);
}

export function journalTokens(journal: Journal, options: Options): number {
  return activeEntries(journal).reduce((sum, entry) => sum + estimateTokens(entry.text, options.tokensPerChar) + 2, 0);
}

// The block the narrator reads. Over budget, the oldest entries are left out, so what is
// sent always reads in order; compression is how they come back.
export function journalBlock(journal: Journal, options: Options): { text: string; omitted: number } {
  const active = activeEntries(journal);
  let omitted = 0;
  let total = journalTokens(journal, options);
  while (total > options.journalTokens && active.length - omitted > 1) {
    total -= estimateTokens(active[omitted]!.text, options.tokensPerChar) + 2;
    omitted += 1;
  }
  const body = active.slice(omitted).map((entry) => entry.text.trim()).filter(Boolean).join('\n\n');
  if (!body) return { text: '', omitted: 0 };
  return { text: `The story so far${omitted ? ' (earliest entries omitted)' : ''}:\n${body}`, omitted };
}

type JournalResult = { ok: true; save: Save } | { ok: false; reason: string };

const withJournal = (save: Save, journal: Partial<Journal>): Save => ({ ...save, journal: { ...save.journal, ...journal } });

function cleanText(text: string): string | null {
  const value = text.replace(/\r\n/g, '\n').trim();
  return value ? value.slice(0, 8000) : null;
}

export function addEntry(save: Save, entryId: string, text: string): JournalResult {
  const value = cleanText(text);
  if (!value) return { ok: false, reason: 'Write something first.' };
  if (save.journal.entries.some((entry) => entry.id === entryId)) return { ok: false, reason: 'That entry already exists.' };
  return { ok: true, save: withJournal(save, { entries: [...save.journal.entries, { id: entryId, text: value, storyT: save.clock, source: 'player', archived: false }] }) };
}

export function editEntry(save: Save, entryId: string, text: string): JournalResult {
  const value = cleanText(text);
  if (!value) return { ok: false, reason: 'An entry cannot be empty. Remove it instead.' };
  if (!save.journal.entries.some((entry) => entry.id === entryId)) return { ok: false, reason: 'That entry no longer exists.' };
  return { ok: true, save: withJournal(save, { entries: save.journal.entries.map((entry) => (entry.id === entryId ? { ...entry, text: value } : entry)) }) };
}

export function removeEntry(save: Save, entryId: string): JournalResult {
  if (!save.journal.entries.some((entry) => entry.id === entryId)) return { ok: false, reason: 'That entry no longer exists.' };
  return { ok: true, save: withJournal(save, { entries: save.journal.entries.filter((entry) => entry.id !== entryId) }) };
}

export function setArchived(save: Save, entryId: string, archived: boolean): JournalResult {
  if (!save.journal.entries.some((entry) => entry.id === entryId)) return { ok: false, reason: 'That entry no longer exists.' };
  return { ok: true, save: withJournal(save, { entries: save.journal.entries.map((entry) => (entry.id === entryId ? { ...entry, archived } : entry)) }) };
}

// Turns with narration that no entry covers yet: what "Suggest an entry now" records.
export function uncoveredTurns(save: Save): { from: number; to: number } | null {
  const from = Math.min(save.journal.coveredTo, save.turns.length);
  let to = save.turns.length;
  while (to > from && !save.turns[to - 1]!.reply) to -= 1;
  return to > from ? { from, to } : null;
}

// The oldest active entries, about half the journal, that a compression would merge.
export function compressionCandidates(journal: Journal, options: Options): string[] {
  const active = activeEntries(journal);
  if (active.length < 2) return [];
  const total = journalTokens(journal, options);
  const chosen: string[] = [];
  let sum = 0;
  for (const entry of active) {
    if (chosen.length >= 2 && sum >= total / 2) break;
    chosen.push(entry.id);
    sum += estimateTokens(entry.text, options.tokensPerChar) + 2;
  }
  return chosen.length >= 2 ? chosen : [];
}

// Due when the active journal is over budget and the player has not declined this size.
export function compressionDue(save: Save): string[] | null {
  const { journal, options } = save;
  if (journal.pending) return null;
  if (journalTokens(journal, options) <= options.journalTokens) return null;
  const active = activeEntries(journal);
  if (journal.compressDeclinedAt && active.length <= journal.compressDeclinedAt) return null;
  const ids = compressionCandidates(journal, options);
  return ids.length >= 2 ? ids : null;
}

export function setPending(save: Save, pending: Pending): Save {
  return withJournal(save, { pending });
}

// Keeps the suggestion, with the player's edits if any.
export function keepPending(save: Save, entryId: string, text?: string): JournalResult {
  const pending = save.journal.pending;
  if (!pending) return { ok: false, reason: 'There is no suggestion to keep.' };
  const value = cleanText(text ?? pending.text);
  if (!value) return { ok: false, reason: 'An entry cannot be empty. Discard it instead.' };
  if (pending.kind === 'entry') {
    const after = save.turns[pending.to];
    const storyT = after ? after.before.clock : save.clock;
    const entry: JournalEntry = { id: entryId, text: value, storyT, source: 'suggested', archived: false, turns: { from: pending.from, to: pending.to } };
    return { ok: true, save: withJournal(save, { entries: [...save.journal.entries, entry], coveredTo: Math.max(save.journal.coveredTo, pending.to), pending: null }) };
  }
  const merged = save.journal.entries.filter((entry) => pending.entryIds.includes(entry.id));
  if (merged.length < 2) return { ok: false, reason: 'The entries this would combine have changed. Discard it and try again.' };
  const storyT = Math.min(...merged.map((entry) => entry.storyT));
  const entry: JournalEntry = { id: entryId, text: value, storyT, source: 'compressed', archived: false, merged: merged.map((item) => item.id) };
  // The new entry takes the place of the first one it replaces, so it reads in order.
  const entries = save.journal.entries.map((item) => (pending.entryIds.includes(item.id) ? { ...item, archived: true } : item));
  const at = entries.findIndex((item) => pending.entryIds.includes(item.id));
  entries.splice(at < 0 ? entries.length : at, 0, entry);
  return { ok: true, save: withJournal(save, { entries, pending: null }) };
}

export function discardPending(save: Save): JournalResult {
  const pending = save.journal.pending;
  if (!pending) return { ok: false, reason: 'There is no suggestion to discard.' };
  if (pending.kind === 'entry') return { ok: true, save: withJournal(save, { pending: null, coveredTo: Math.max(save.journal.coveredTo, pending.to) }) };
  return { ok: true, save: withJournal(save, { pending: null, compressDeclinedAt: activeEntries(save.journal).length }) };
}

// --- Requests to the model. The interface sends them; the replies come back as suggestions.

function playerName(module: PraxisModule, save: Save): string {
  const world = playable(module, save.local);
  return world.characters.find((character) => character.id === module.scenario.playerCharacterId)?.name ?? 'the player character';
}

const ENTRY_RULES = (player: string) => [
  'You keep the journal of a roleplay story: a short record of what happened, so the story can be remembered after these passages are gone.',
  `Write ONE journal entry covering only the passages below. Past tense, third person. The player's character is ${player}: call them that, never "you" or "I".`,
  'Keep what will matter later: who was met and their names, places, promises and bargains, what changed, what was learned, and what was left unresolved. Drop atmosphere, description and blow-by-blow detail.',
  'Two to five sentences of plain prose. No lists, headings, title or commentary, and nothing about the story being a game.',
  'Do not repeat what the earlier entries already record, and add nothing the passages do not say.',
].join('\n');

export function entryRequest(module: PraxisModule, save: Save, range: { from: number; to: number }): { messages: ChatMessage[]; maxTokens: number } {
  const player = playerName(module, save);
  const earlier = activeEntries(save.journal).slice(-3).map((entry) => entry.text.trim());
  const passages: string[] = [];
  if (range.from === 0 && module.scenario.opening.trim()) passages.push(`Narrator: ${module.scenario.opening.trim()}`);
  for (const turn of save.turns.slice(range.from, range.to)) {
    passages.push(`Player, as ${player}: ${turn.input}`);
    if (turn.reply) passages.push(`Narrator: ${turn.reply}`);
  }
  const parts = [
    earlier.length ? `Earlier entries, already recorded:\n${earlier.join('\n\n')}` : 'There are no earlier entries.',
    `Passages to record:\n${passages.join('\n\n')}`,
    'Write the entry.',
  ];
  return { messages: [{ role: 'system', content: ENTRY_RULES(player) }, { role: 'user', content: parts.join('\n\n') }], maxTokens: 300 };
}

export function compressRequest(module: PraxisModule, save: Save, entryIds: readonly string[]): { messages: ChatMessage[]; maxTokens: number } {
  const player = playerName(module, save);
  const chosen = activeEntries(save.journal).filter((entry) => entryIds.includes(entry.id));
  const source = chosen.map((entry) => entry.text.trim()).join('\n\n');
  const rules = [
    'You keep the journal of a roleplay story. Combine the entries below into one shorter entry for long-term memory.',
    `Keep names, places, relationships, promises and outcomes; drop atmosphere and repetition. Past tense, third person; the player's character is ${player}.`,
    'Aim for half the length or less. Plain prose: no lists, headings or commentary. Write only the entry.',
  ].join('\n');
  const maxTokens = Math.max(80, Math.min(700, Math.ceil(estimateTokens(source, save.options.tokensPerChar) / 2) + 60));
  return { messages: [{ role: 'system', content: rules }, { role: 'user', content: `Entries, oldest first:\n${source}` }], maxTokens };
}

// Tidies a suggestion: no leaked thinking, labels or wrapping quotes.
export function cleanSuggestion(text: string): string {
  let value = text.replace(/\r\n/g, '\n');
  value = value.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim();
  value = value.replace(/^(?:journal entry|entry|summary)\s*:\s*/i, '').trim();
  if (value.length > 1 && value.startsWith('"') && value.endsWith('"') && !value.slice(1, -1).includes('"')) value = value.slice(1, -1).trim();
  return value.replace(/\n{3,}/g, '\n\n');
}
