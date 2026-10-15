import { describe, expect, it } from 'vitest';
import {
  act, addEntry, addRecord, calibrate, compileContext, compressRequest, compressionDue, contextPlan, discardPending, editEntry,
  entryRequest, exportRecords, importRecords, journalBlock, journalDue, keepPending, parseSave, playable, readRecordsFile,
  recordPromptSize, removeRecord, say, sceneActionsFor, sceneOf, setArchived, setOptions, setPending, setReply, startSave,
  uncoveredTurns, updateRecord, activeEntries, type Save,
} from '../src/engine';
import { abernys } from './abernys';

const module = abernys();

function must<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error((result as unknown as { reason: string }).reason);
  return result as Extract<T, { ok: true }>;
}

describe('scene actions', () => {
  it('are settled by the rules and carry their outcome', () => {
    const start = startSave(module);
    expect(sceneActionsFor(module, start).map((action) => action.id)).toEqual(['sign-the-covenant']);
    const { save, turn, entries } = must(act(module, start, 't1', { type: 'scene', actionId: 'sign-the-covenant' }));
    expect(turn).toMatchObject({ kind: 'action', input: 'I sign the Covenant.' });
    expect(turn.directive).toMatch(/signs the Covenant/);
    expect(entries).toEqual([{ kind: 'state', at: start.clock, defId: 'signed-covenant', owner: 'traveller', from: 0, to: 1, source: 'rule' }]);
    expect(sceneActionsFor(module, save)).toEqual([]);
    expect(act(module, save, 't2', { type: 'scene', actionId: 'sign-the-covenant' })).toEqual({ ok: false, reason: 'Sign the Covenant is not possible here and now.' });
    expect(act(module, save, 't2', { type: 'travel', to: 'port-covenant' }).ok).toBe(true);
  });

  it('are offered only where they belong', () => {
    const signed = must(act(module, startSave(module), 't1', { type: 'scene', actionId: 'sign-the-covenant' })).save;
    const lanes = must(act(module, { ...startSave(module) }, 't1', { type: 'travel', to: 'pc-outside-walls' })).save;
    expect(sceneActionsFor(module, lanes)).toEqual([]);
    expect(signed.values.traveller?.['signed-covenant']).toBe(1);
  });
});

describe('local records', () => {
  it('can be someone present, whom the narrator then sees', () => {
    const start = startSave(module);
    const { save, entries } = must(addRecord(module, start, { id: 'local-teo', type: 'person', name: 'Teo', summary: 'A gate runner', description: 'Carries messages through the gate for a copper a trip.', speciesId: 'humans' }, 'pc-landward-gate'));
    expect(entries).toMatchObject([{ kind: 'move', characterId: 'local-teo', to: 'pc-landward-gate', source: 'player' }]);
    expect(sceneOf(module, save).present.map((person) => person.name)).toContain('Teo');
    const withTurn = must(say(module, save, 't1', 'I look around.')).save;
    const messages = compileContext(module, withTurn);
    expect(messages.at(-1)!.content).toMatch(/Teo, a gate runner, Humans: Carries messages/);
    expect(messages[0]!.content).toMatch(/- Teo \(Humans\): a gate runner\./);
  });

  it('can be a place to travel to, but only inside somewhere you can stand', () => {
    const signed = must(act(module, startSave(module), 't1', { type: 'scene', actionId: 'sign-the-covenant' })).save;
    expect(addRecord(module, signed, { id: 'local-farm', type: 'place', name: 'A farmstead', parentLocationId: 'nospier-point' }))
      .toEqual({ ok: false, reason: 'Nospier Point is a whole area. Put it inside somewhere you can stand, such as a town or a building.' });
    const save = must(addRecord(module, signed, { id: 'local-inn', type: 'place', name: 'The Salt Lamp', kind: 'building', description: 'A tavern by the slips.', parentLocationId: 'pc-harbour' })).save;
    const moved = must(act(module, save, 't2', { type: 'travel', to: 'local-inn' })).save;
    expect(sceneOf(module, moved).place.name).toBe('The Salt Lamp');
    expect(removeRecord(module, moved, 'local-inn')).toEqual({ ok: false, reason: 'Someone is at The Salt Lamp. Move them first.' });
  });

  it('can be a thing lying somewhere', () => {
    const save = must(addRecord(module, startSave(module), { id: 'local-ledger', type: 'thing', name: 'The gate ledger', description: 'Every signature since the arrival.', locationId: 'pc-landward-gate' })).save;
    expect(sceneOf(module, save).things.map((thing) => thing.name)).toEqual(['The gate ledger']);
    const moment = compileContext(module, must(say(module, save, 't1', 'I look.')).save).at(-1)!.content;
    expect(moment).toMatch(/\[Here: The gate ledger: Every signature since the arrival\.\]/);
  });

  it('are checked against the world', () => {
    const start = startSave(module);
    expect(addRecord(module, start, { id: 'gate-arbiter', type: 'person', name: 'Twin' })).toEqual({ ok: false, reason: 'The id "gate-arbiter" is already taken.' });
    expect(addRecord(module, start, { id: 'x', type: 'person', name: 'X', factionIds: ['the-council'] })).toEqual({ ok: false, reason: 'There is no group "the-council".' });
    const save = must(addRecord(module, start, { id: 'local-teo', type: 'person', name: 'Teo' })).save;
    expect(must(updateRecord(module, save, 'local-teo', { summary: 'A gate runner' })).record.summary).toBe('A gate runner');
  });

  it('leave the module untouched', () => {
    const before = JSON.stringify(module);
    must(addRecord(module, startSave(module), { id: 'local-teo', type: 'person', name: 'Teo' }, 'pc-landward-gate'));
    expect(JSON.stringify(module)).toBe(before);
    expect(playable(module, [])).toBe(module);
  });

  it('round-trip through a records file into another save', () => {
    let save = must(addRecord(module, startSave(module), { id: 'local-salt', type: 'group', name: 'The Salt Lamp regulars' })).save;
    save = must(addRecord(module, save, { id: 'local-teo', type: 'person', name: 'Teo', factionIds: ['local-salt'], playerNote: 'Owes me.' })).save;
    const file = JSON.parse(JSON.stringify(exportRecords(module, save)));
    const read = readRecordsFile(file);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const imported = importRecords(module, startSave(module), read.file.records);
    expect(imported.added).toBe(2);
    expect(imported.skipped).toEqual([]);
    expect(importRecords(module, imported.save, read.file.records).skipped).toHaveLength(2);
    expect(readRecordsFile({ format: 'nope' })).toEqual({ ok: false, errors: ['This is not a Praxis records file.'] });
  });

  it('survive a save round trip', () => {
    const save = must(addRecord(module, startSave(module), { id: 'local-teo', type: 'person', name: 'Teo' }, 'pc-landward-gate')).save;
    const parsed = parseSave(module, JSON.parse(JSON.stringify(save)));
    expect(parsed.ok).toBe(true);
  });
});

describe('the context', () => {
  it('names who and what is in the world, so nothing is invented', () => {
    const save = must(say(module, startSave(module), 't1', 'Who runs this place?')).save;
    const system = compileContext(module, save)[0]!.content;
    expect(system).toMatch(/- Ottavio Marrane \(Humans\): the Governor; usually at the Governor's court\./);
    expect(system).toMatch(/- The gate Arbiter \(Humans\): An Arbiter on duty at the landward gate, with the Covenant's terms, ink, and a ledger of everyone who has signed, of the Arbiters; usually at the landward gate\./);
    expect(system).toMatch(/- The Arbiters \(faction\): A monastic order of notaries headed by the High Arbiter\./);
    expect(system).toMatch(/Places:\n- Abernys \(major region\)/);
    expect(system).not.toMatch(/- The traveller/);
  });

  it('brings in the groups and history that bear on the scene', () => {
    const save = must(say(module, startSave(module), 't1', 'I wait.')).save;
    const moment = compileContext(module, save).at(-1)!.content;
    expect(moment).toMatch(/\[Bearing on this scene: The Arbiters: A monastic order/);
    expect(moment).toMatch(/The Pact: The humans of Port Covenant/);
    const signed = must(act(module, startSave(module), 't0', { type: 'scene', actionId: 'sign-the-covenant' })).save;
    const inside = must(act(module, signed, 't1', { type: 'travel', to: 'port-covenant' })).save;
    expect(compileContext(module, inside).at(-1)!.content).toMatch(/\[History here: The arrival: Humans driven from the homeland/);
  });

  it('sends the journal after the canon and before the transcript', () => {
    let save = must(addEntry(startSave(module), 'j1', 'The traveller reached the gate in fog.')).save;
    save = must(say(module, save, 't1', 'I wait.')).save;
    const system = compileContext(module, save)[0]!.content;
    expect(system.endsWith('The story so far:\nThe traveller reached the gate in fog.')).toBe(true);
  });

  it('keeps the transcript start fixed between cuts, then cuts a whole piece', () => {
    let save = must(setOptions(startSave(module), { contextTokens: 8000, journalTokens: 300, replyTokens: 200, pieceTokens: 1500 })).save;
    const reply = 'Rain runs off the wall and the Arbiter keeps writing. '.repeat(12);
    const starts: number[] = [];
    for (let index = 0; index < 30; index++) {
      save = must(say(module, save, `t${index}`, `Turn ${index}.`)).save;
      starts.push(save.turns.at(-1)!.windowStart);
      save = must(setReply(save, `t${index}`, reply)).save;
    }
    const moves = starts.filter((start, index) => index > 0 && start !== starts[index - 1]);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.length).toBeLessThan(10);
    for (let index = 1; index < starts.length; index++) expect(starts[index]).toBeGreaterThanOrEqual(starts[index - 1]!);
    const plan = contextPlan(module, must(say(module, save, 'last', 'Go on.')).save);
    expect(plan.estimate.total + plan.budget.reply).toBeLessThanOrEqual(8000);
  });
});

describe('the journal', () => {
  function crowded(): Save {
    let save = must(setOptions(startSave(module), { contextTokens: 8000, journalTokens: 300, replyTokens: 200, pieceTokens: 1500 })).save;
    const reply = 'The fog thickens and the Arbiter waits for an answer. '.repeat(12);
    for (let index = 0; index < 30; index++) {
      save = must(say(module, save, `t${index}`, `Turn ${index}.`)).save;
      save = must(setReply(save, `t${index}`, reply)).save;
      if (journalDue(module, save)) return save;
    }
    throw new Error('The journal never came due.');
  }

  it('comes due before story leaves the window, and covers it once kept', () => {
    const save = crowded();
    const due = journalDue(module, save)!;
    expect(due.from).toBe(0);
    expect(due.to).toBeGreaterThan(0);
    const request = entryRequest(module, save, due);
    expect(request.messages[0]!.content).toMatch(/Write ONE journal entry/);
    expect(request.messages[1]!.content).toMatch(/Narrator: \*Fog lies over/);
    expect(request.messages[1]!.content).toMatch(/Player, as The traveller: Turn 0\./);
    const pending = setPending(save, { kind: 'entry', ...due, text: 'The traveller waited at the gate.' });
    expect(journalDue(module, pending)).toBeNull();
    const kept = must(keepPending(pending, 'j1')).save;
    expect(kept.journal.coveredTo).toBe(due.to);
    expect(activeEntries(kept.journal).map((entry) => entry.source)).toEqual(['suggested']);
    expect(journalDue(module, kept)).toBeNull();
  });

  it('passes over a discarded suggestion', () => {
    const save = crowded();
    const due = journalDue(module, save)!;
    const discarded = must(discardPending(setPending(save, { kind: 'entry', ...due, text: 'x' }))).save;
    expect(discarded.journal.coveredTo).toBe(due.to);
    expect(discarded.journal.entries).toEqual([]);
  });

  it('compresses the oldest entries when over budget, keeping the originals archived', () => {
    let save = must(setOptions(startSave(module), { journalTokens: 300 })).save;
    for (let index = 0; index < 6; index++) save = must(addEntry(save, `j${index}`, `Entry ${index}. ${'Something happened at the gate. '.repeat(8)}`)).save;
    const ids = compressionDue(save)!;
    expect(ids.slice(0, 2)).toEqual(['j0', 'j1']);
    expect(compressRequest(module, save, ids).messages[1]!.content).toMatch(/^Entries, oldest first:\nEntry 0\./);
    const kept = must(keepPending(setPending(save, { kind: 'compress', entryIds: ids, text: 'Much happened at the gate.' }), 'c1')).save;
    expect(activeEntries(kept.journal)[0]).toMatchObject({ id: 'c1', source: 'compressed', merged: ids });
    expect(kept.journal.entries.filter((entry) => entry.archived).map((entry) => entry.id)).toEqual(ids);
    const declined = must(discardPending(setPending(save, { kind: 'compress', entryIds: ids, text: 'x' }))).save;
    expect(compressionDue(declined)).toBeNull();
  });

  it('leaves out the oldest entries when over budget, keeping reading order', () => {
    let save = must(setOptions(startSave(module), { journalTokens: 300 })).save;
    for (let index = 0; index < 6; index++) save = must(addEntry(save, `j${index}`, `Entry ${index}. ${'Something happened. '.repeat(10)}`)).save;
    const block = journalBlock(save.journal, save.options);
    expect(block.omitted).toBeGreaterThan(0);
    expect(block.text).toMatch(/^The story so far \(earliest entries omitted\):\nEntry \d/);
    expect(block.text).toMatch(/Entry 5\./);
  });

  it('lets the player write, edit and archive anything', () => {
    let save = must(addEntry(startSave(module), 'j1', 'Find out what the Covenant binds a signer to.')).save;
    save = must(editEntry(save, 'j1', 'Find out what the Covenant binds a signer to before signing.')).save;
    save = must(setArchived(save, 'j1', true)).save;
    expect(journalBlock(save.journal, save.options).text).toBe('');
    expect(addEntry(save, 'j2', '   ')).toEqual({ ok: false, reason: 'Write something first.' });
  });

  it('can be asked for an entry on demand', () => {
    let save = must(say(module, startSave(module), 't1', 'Hello.')).save;
    expect(uncoveredTurns(save)).toBeNull();
    save = must(setReply(save, 't1', '*She looks up.*')).save;
    expect(uncoveredTurns(save)).toEqual({ from: 0, to: 1 });
  });
});

describe('token estimates', () => {
  it('follow what NovelAI reports, slowly', () => {
    expect(calibrate(0.3, 1000, 250)).toBe(0.285);
    expect(calibrate(0.3, 10, 250)).toBe(0.3);
    const save = recordPromptSize(startSave(module), 4000, 1000);
    expect(save.options.tokensPerChar).toBe(0.285);
  });

  it('old saves open with defaults', () => {
    const save = JSON.parse(JSON.stringify(startSave(module)));
    delete save.journal;
    delete save.local;
    delete save.options;
    const parsed = parseSave(module, save);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.save.options.contextTokens).toBe(28_000);
    expect(parsed.save.journal.entries).toEqual([]);
  });
});
