import { describe, expect, it } from 'vitest';
import {
  act, cleanReply, compileContext, contextPlan, replyFrom, exportSave, lastTurn, parseSave, readSaveFile, roughDuration, say, sceneOf, setReply,
  setOptions, setState, startSave, undoLastTurn, type Save,
} from '../src/engine';
import { abernys } from './abernys';

const module = abernys();

function must<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error((result as unknown as { reason: string }).reason);
  return result as Extract<T, { ok: true }>;
}

function signed(): Save {
  return must(setState(module, startSave(module), 'signed-covenant', 'traveller', 1)).save;
}

describe('turns', () => {
  it('record speech with no outcome', () => {
    const { save, turn } = must(say(module, startSave(module), 't1', '  I hold out my hand for the pen.  '));
    expect(turn).toMatchObject({ id: 't1', kind: 'say', input: 'I hold out my hand for the pen.', directive: null, reply: null });
    expect(save.turns).toHaveLength(1);
    expect(say(module, save, 't2', '   ').ok).toBe(false);
  });

  it('resolve an action first and carry its outcome', () => {
    const { save, turn } = must(act(module, signed(), 't1', { type: 'travel', to: 'pc-harbour' }));
    expect(turn.input).toBe('I head for the harbour.');
    expect(turn.directive).toMatch(/^You have just arrived at the harbour after a short walk/);
    expect(sceneOf(module, save).place.id).toBe('pc-harbour');
  });

  it('refuse an action the rules refuse, changing nothing', () => {
    expect(act(module, startSave(module), 't1', { type: 'travel', to: 'pc-harbour' }))
      .toEqual({ ok: false, reason: 'No one enters the port without signing the Covenant.' });
  });

  it('describe durations the way a narrator would', () => {
    expect(roughDuration(13)).toBe('a short walk');
    expect(roughDuration(330)).toBe('a few hours');
    expect(roughDuration(960)).toBe('more than a day');
  });
});

describe('reroll and undo', () => {
  it('put narration on the latest turn only, and replace it on reroll', () => {
    let save = must(say(module, startSave(module), 't1', 'Hello.')).save;
    save = must(setReply(save, 't1', 'First.')).save;
    save = must(setReply(save, 't1', 'Second.')).save;
    expect(lastTurn(save)?.reply).toBe('Second.');
    save = must(say(module, save, 't2', 'Again.')).save;
    expect(setReply(save, 't1', 'Late.')).toEqual({ ok: false, reason: 'That turn is no longer the latest.' });
  });

  it('keep a rerolled action resolved', () => {
    let save = must(act(module, signed(), 't1', { type: 'travel', to: 'pc-harbour' })).save;
    const clock = save.clock;
    save = must(setReply(save, 't1', 'You arrive.')).save;
    save = must(setReply(save, 't1', 'You arrive again.')).save;
    expect(save.clock).toBe(clock);
    expect(save.ledger.filter((entry) => entry.kind === 'move')).toHaveLength(1);
  });

  it('undo restores the world and drops what the turn recorded', () => {
    const before = signed();
    const after = must(act(module, before, 't1', { type: 'travel', to: 'caerwyn' })).save;
    const undone = must(undoLastTurn(after)).save;
    expect(undone.clock).toBe(before.clock);
    expect(undone.positions).toEqual(before.positions);
    expect(undone.ledger).toEqual(before.ledger);
    expect(undone.turns).toEqual([]);
    expect(undoLastTurn(undone).ok).toBe(false);
  });
});

describe('the narrator\'s context', () => {
  it('puts what never changes first, the scene\'s lore next, your words last, and the reply\'s opening after', () => {
    let save = must(say(module, startSave(module), 't1', 'I hold out my hand for the pen.')).save;
    save = must(setReply(save, 't1', '*She hands it over.*')).save;
    save = must(say(module, save, 't2', 'I sign.')).save;
    const plan = contextPlan(module, save);
    const messages = plan.messages;
    expect(messages.map((message) => message.role)).toEqual(['system', 'system', 'assistant', 'user', 'assistant', 'user']);
    expect(messages[0]!.content).toMatch(/^You narrate a text adventure\. The player is the traveller/);
    expect(messages[0]!.content).toMatch(/Established facts:/);
    expect(messages[0]!.content).toMatch(/Speech is plain text, with no quotation marks\. Thoughts go in \(parentheses\)/);
    // The format, shown by example from another story.
    expect(messages[0]!.content).toContain('An example of the format, from another story:');
    const lore = messages[1]!.content;
    // Every lore entry is one bracketed line: you, where you are, who is present.
    expect(lore.split('\n').every((entry) => /^\[ .* \]$/.test(entry))).toBe(true);
    expect(lore).toMatch(/^\[ You are the traveller: /);
    expect(lore).toContain('[ The landward gate, Nospier Point, Abernys: Where the headland road meets the colony wall.');
    expect(lore).toContain('The way to Port Covenant is closed to you. No one enters the port without signing the Covenant.');
    expect(lore).toMatch(/\[ Present at the landward gate, early morning: The gate Arbiter, keeping the ledger at the landward gate\. /);
    expect(messages[3]!.content).toBe('I hold out my hand for the pen.');
    // Your turn holds only what you wrote.
    expect(messages[5]!.content).toBe('I sign.');
    expect(plan.prefill).toMatch(/^Understood\. I will:\n/);
    expect(plan.prefill).toContain('- Show how the world answers what you just did, and leave the outcome of anything uncertain open');
    expect(plan.prefill.endsWith('- Stop where you can act again\n[Of course, here you go:]\n*')).toBe(true);
    expect(replyFrom(plan, 'She pushes the ledger across.* Sign there.')).toBe('*She pushes the ledger across.* Sign there.');
    expect(replyFrom(plan, '*She pushes the ledger across.*')).toBe('*She pushes the ledger across.*');
  });

  it('keeps conditions true in the reply\'s opening, and an outcome once, then in the transcript', () => {
    let save = must(setState(module, signed(), 'health', 'gate-guard', 1)).save;
    save = must(say(module, save, 't1', 'I look at the guard.')).save;
    const plan = contextPlan(module, save);
    expect(plan.prefill).toMatch(/\n- Keep true: .*You have signed the Covenant\./);
    expect(plan.prefill).toContain('The garrison guard is hurt: bleeding and slowed, but still fighting.');
    expect(plan.prefill).not.toMatch(/is unhurt/);
    expect(plan.prefill).not.toContain('Show what the rules decided');
    save = must(setReply(save, 't1', '*He leans on his pike.*')).save;
    save = must(act(module, save, 't2', { type: 'travel', to: 'pc-outside-walls' })).save;
    const next = contextPlan(module, save);
    expect(next.prefill).toMatch(/\n- Show what the rules decided: You have just arrived at the outer lanes after [^\n]*\.\n/);
    expect(next.messages.some((message) => message.content.includes('Outcome: You have just arrived'))).toBe(false);
    save = must(setReply(save, 't2', '*Mud and washing lines.*')).save;
    save = must(say(module, save, 't3', 'I look around.')).save;
    const later = contextPlan(module, save);
    // Once it is past, what the rules decided stays with your words in the transcript.
    expect(later.messages.filter((message) => message.content.includes('[ Outcome: You have just arrived at the outer lanes'))).toHaveLength(1);
    expect(later.messages.find((message) => message.content.includes('[ Outcome: You have just arrived'))!.content).toMatch(/^I head for the outer lanes\.\n\n\[ Outcome: /);
  });

  it('never names the clock\'s numbers', () => {
    const save = must(say(module, startSave(module), 't1', 'I wait.')).save;
    const all = compileContext(module, save).map((message) => message.content).join('\n');
    expect(all).not.toMatch(/07:40|Sunday|January/);
  });

  it('drops the opening once the transcript outgrows the window', () => {
    let save = must(setOptions(startSave(module), { contextTokens: 6000, journalTokens: 300, replyTokens: 200, pieceTokens: 1000 })).save;
    const long = 'The fog thickens over the wall and the gulls go quiet. '.repeat(20);
    for (let index = 0; index < 12; index++) {
      save = must(say(module, save, `t${index}`, `Line ${index}.`)).save;
      save = must(setReply(save, `t${index}`, long)).save;
    }
    save = must(say(module, save, 'last', 'And now?')).save;
    const messages = compileContext(module, save);
    expect(messages.some((message) => message.content.includes('Fog lies over'))).toBe(false);
    expect(messages.some((message) => message.content.includes('Line 0.'))).toBe(false);
    expect(messages.some((message) => message.content.includes('Line 11.'))).toBe(true);
  });
});

describe('replies', () => {
  it('lose a speaker label and an echo of the player', () => {
    expect(cleanReply('Narrator: *Rain.*', 'x')).toBe('*Rain.*');
    expect(cleanReply('I sign. *The ink is wet.*', 'I sign.')).toBe('*The ink is wet.*');
  });
});

describe('save files', () => {
  it('round-trip with their module', () => {
    const save = must(act(module, signed(), 't1', { type: 'travel', to: 'pc-harbour' })).save;
    const file = JSON.parse(JSON.stringify(exportSave(module, save, 'My run')));
    const read = readSaveFile(file);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.name).toBe('My run');
    expect(read.save).toEqual(JSON.parse(JSON.stringify(save)));
  });

  it('refuse a save that does not match its module', () => {
    const save = { ...startSave(module), positions: { traveller: 'atlantis' } };
    const result = parseSave(module, JSON.parse(JSON.stringify(save)));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain('The save puts someone at "atlantis", which is not in the module.');
    expect(readSaveFile({ format: 'something-else' })).toEqual({ ok: false, errors: ['This is not a Praxis save file.'] });
  });
});

describe('reasoning leaks', () => {
  it('are removed from replies', () => {
    expect(cleanReply('<think>The gate...</think>\n*Rain.*', 'x')).toBe('*Rain.*');
    expect(cleanReply('half a thought</think>*Rain.*', 'x')).toBe('*Rain.*');
  });
});
