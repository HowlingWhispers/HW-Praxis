// Turns: the transcript's unit, and the boundary for reroll and undo.
//
// A turn is created by the player speaking or acting. An action is resolved by the rules
// first; the turn then carries the outcome as a directive for the narrator. A reroll replaces
// the narration and never resolves the action again. Undo restores the world as it was before
// the turn and drops everything recorded since, including any hand edits made after it.
//
// Turn ids are passed in, never generated here, so the engine stays deterministic.

import { atlasOf } from './world';
import { durationWords } from './clock';
import type { PraxisModule } from './module';
import { travel, wait, type ActionResult, type LedgerEntry, type Save, type Turn, type WorldState } from './session';

export type TurnResult =
  | { ok: true; save: Save; turn: Turn; entries: LedgerEntry[] }
  | { ok: false; reason: string };

function worldOf(save: Save): WorldState {
  return { clock: save.clock, positions: save.positions, values: save.values };
}

function open(before: Save, after: Save, turn: Omit<Turn, 'before' | 'ledgerStart' | 'reply'>, entries: LedgerEntry[]): TurnResult {
  const full: Turn = { ...turn, reply: null, before: worldOf(before), ledgerStart: before.ledger.length };
  return { ok: true, save: { ...after, turns: [...after.turns, full] }, turn: full, entries };
}

// A name as it reads inside a sentence: "The harbour" becomes "the harbour".
export function inSentence(name: string): string {
  return name.startsWith('The ') ? `the ${name.slice(4)}` : name;
}

// How long something took, in the words a narrator would use. Exact minutes stay off the page.
export function roughDuration(minutes: number): string {
  if (minutes < 20) return 'a short walk';
  if (minutes < 90) return 'about an hour';
  if (minutes < 6 * 60) return 'a few hours';
  if (minutes < 12 * 60) return 'most of a day';
  return 'more than a day';
}

export function say(save: Save, id: string, text: string): TurnResult {
  const input = text.trim();
  if (!input) return { ok: false, reason: 'Write something first.' };
  return open(save, save, { id, kind: 'say', input, directive: null }, []);
}

export type Action =
  | { type: 'travel'; to: string }
  | { type: 'wait'; minutes: number };

export function act(module: PraxisModule, save: Save, id: string, action: Action): TurnResult {
  let result: ActionResult;
  let input: string;
  let directive: string;
  if (action.type === 'travel') {
    const place = atlasOf(module).places.get(action.to);
    result = travel(module, save, action.to);
    if (!result.ok) return result;
    const move = result.entries.find((entry): entry is Extract<LedgerEntry, { kind: 'move' }> => entry.kind === 'move');
    const minutes = move?.minutes ?? 0;
    const name = inSentence(place?.name ?? action.to);
    input = `I head for ${name}.`;
    directive = `The player has just arrived at ${name} after ${roughDuration(minutes)}. Describe the arrival and what they find.`;
  } else {
    result = wait(save, action.minutes);
    if (!result.ok) return result;
    input = `I wait for ${durationWords(action.minutes)}.`;
    directive = `Time passes where the player is: ${roughDuration(action.minutes).replace('a short walk', 'a little while')}. Describe what changes, if anything.`;
  }
  return open(save, result.save, { id, kind: 'action', input, directive }, result.entries);
}

export function lastTurn(save: Save): Turn | null {
  return save.turns[save.turns.length - 1] ?? null;
}

// Narration lands on the latest turn only. A reply for an older turn is stale by definition.
export function setReply(save: Save, turnId: string, reply: string): { ok: true; save: Save } | { ok: false; reason: string } {
  const last = lastTurn(save);
  if (!last || last.id !== turnId) return { ok: false, reason: 'That turn is no longer the latest.' };
  const text = reply.trim();
  if (!text) return { ok: false, reason: 'The narrator returned nothing.' };
  return { ok: true, save: { ...save, turns: [...save.turns.slice(0, -1), { ...last, reply: text }] } };
}

export function undoLastTurn(save: Save): { ok: true; save: Save; turn: Turn } | { ok: false; reason: string } {
  const last = lastTurn(save);
  if (!last) return { ok: false, reason: 'There is nothing to undo.' };
  return {
    ok: true,
    turn: last,
    save: { ...save, ...last.before, ledger: save.ledger.slice(0, last.ledgerStart), turns: save.turns.slice(0, -1) },
  };
}

// Tidies a model reply: drops a speaker label the model added and an echo of the player's words.
export function cleanReply(reply: string, input: string): string {
  let text = reply.replace(/\r\n/g, '\n').trim();
  text = text.replace(/^(?:narrator|assistant|gm)\s*:\s*/i, '');
  const echo = input.trim();
  if (echo && text.startsWith(echo)) text = text.slice(echo.length).trim();
  return text.replace(/\n{3,}/g, '\n\n');
}
