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
import { stateDefFor, type PraxisModule, type SceneAction } from './module';
import { read, write, type StateTerminal } from './state';
import { playable } from './records';
import { windowStartFor } from './context';
import { playerOf, travel, wait, type ActionResult, type LedgerEntry, type Save, type Turn, type WorldState } from './session';

export type TurnResult =
  | { ok: true; save: Save; turn: Turn; entries: LedgerEntry[]; terminals: StateTerminal[] }
  | { ok: false; reason: string };

function worldOf(save: Save): WorldState {
  return { clock: save.clock, positions: save.positions, values: save.values };
}

function open(module: PraxisModule, before: Save, after: Save, turn: Omit<Turn, 'before' | 'ledgerStart' | 'reply' | 'windowStart'>, entries: LedgerEntry[], terminals: StateTerminal[] = []): TurnResult {
  const draft: Turn = { ...turn, reply: null, before: worldOf(before), ledgerStart: before.ledger.length, windowStart: 0 };
  const withTurn: Save = { ...after, turns: [...after.turns, draft] };
  const full: Turn = { ...draft, windowStart: windowStartFor(module, withTurn) };
  return { ok: true, save: { ...after, turns: [...after.turns, full] }, turn: full, entries, terminals };
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

export function say(module: PraxisModule, save: Save, id: string, text: string): TurnResult {
  const input = text.trim();
  if (!input) return { ok: false, reason: 'Write something first.' };
  return open(module, save, save, { id, kind: 'say', input, directive: null }, []);
}

export type Action =
  | { type: 'travel'; to: string }
  | { type: 'wait'; minutes: number }
  | { type: 'scene'; actionId: string };

// Whether an authored action is offered to the player where they are now.
function offered(module: PraxisModule, save: Save, action: SceneAction): boolean {
  const playerId = playerOf(module);
  const here = save.positions[playerId];
  if (action.placeIds.length && (!here || !action.placeIds.includes(here))) return false;
  return action.when.every((condition) => {
    const def = stateDefFor(module, condition.stateId, playerId);
    if (!def) return false;
    const value = read(save.values, def, playerId);
    return (condition.atLeast === undefined || value >= condition.atLeast) && (condition.atMost === undefined || value <= condition.atMost);
  });
}

export function sceneActionsFor(module: PraxisModule, save: Save): SceneAction[] {
  return module.ruleset.actions.filter((action) => offered(module, save, action));
}

// Resolves an authored action: its effects are written by the rules, in order.
function resolveScene(module: PraxisModule, save: Save, action: SceneAction): ActionResult {
  const playerId = playerOf(module);
  let values = save.values;
  const entries: LedgerEntry[] = [];
  const terminals: StateTerminal[] = [];
  for (const effect of action.effects) {
    const def = stateDefFor(module, effect.stateId, playerId);
    if (!def) return { ok: false, reason: `"${effect.stateId}" is not a state here.` };
    const current = read(values, def, playerId);
    const next = effect.set !== undefined ? effect.set : current + (effect.add ?? 0);
    const result = write(values, def, playerId, next, 'rule');
    values = result.values;
    if (result.change) entries.push({ kind: 'state', at: save.clock, ...result.change });
    if (result.terminal) terminals.push(result.terminal);
  }
  return { ok: true, save: { ...save, values, ledger: [...save.ledger, ...entries] }, entries, terminals };
}

export function act(module: PraxisModule, save: Save, id: string, action: Action): TurnResult {
  const world = playable(module, save.local);
  let result: ActionResult;
  let input: string;
  let directive: string;
  if (action.type === 'scene') {
    const chosen = world.ruleset.actions.find((entry) => entry.id === action.actionId);
    if (!chosen) return { ok: false, reason: 'That action does not exist.' };
    if (!offered(world, save, chosen)) return { ok: false, reason: `${chosen.name} is not possible here and now.` };
    result = resolveScene(world, save, chosen);
    if (!result.ok) return result;
    return open(world, save, result.save, { id, kind: 'action', input: chosen.input, directive: chosen.outcome }, result.entries, result.terminals);
  }
  if (action.type === 'travel') {
    const place = atlasOf(world).places.get(action.to);
    result = travel(world, save, action.to);
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
  return open(world, save, result.save, { id, kind: 'action', input, directive }, result.entries, result.terminals);
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
  let text = reply.replace(/\r\n/g, '\n');
  // A reasoning model may leave its thinking in the reply.
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim();
  text = text.replace(/^(?:narrator|assistant|gm)\s*:\s*/i, '');
  const echo = input.trim();
  if (echo && text.startsWith(echo)) text = text.slice(echo.length).trim();
  return text.replace(/\n{3,}/g, '\n\n');
}
