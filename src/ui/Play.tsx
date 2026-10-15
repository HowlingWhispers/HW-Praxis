// Playing a save: the transcript and composer first, the rules panels below.
// Every change goes through the engine; this file only decides what to show and when to ask
// the narrator.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  act, appliesTo, cleanReply, compileContext, destinationsFrom, durationWords, exportSave, lastTurn, playerOf, say, sceneOf,
  setReply, setState, stateDefFor, undoLastTurn, inSentence,
  type Action, type ChatMessage, type LedgerEntry, type PraxisModule, type Save, type StateDef,
} from '../engine';
import type { Connection } from './Connect';
import { RichText } from './RichText';
import { StateRows } from './StateRows';
import { downloadJson, fileSafe } from './files';
import { NarrationError, narrate, type Diagnostics } from './novelai';

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `t${Date.now()}${Math.random().toString(16).slice(2)}`;
}

export function Play({ module, initial, name, connection, onConnect, onChange, onClose }: {
  module: PraxisModule;
  initial: Save;
  name: string;
  connection: Connection;
  onConnect: () => void;
  onChange: (save: Save) => void;
  onClose: () => void;
}) {
  const [save, setSave] = useState<Save>(initial);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastSent, setLastSent] = useState<ChatMessage[] | null>(null);
  const [calls, setCalls] = useState<{ at: string; ok: boolean; ms: number; message: string; diagnostics: Diagnostics | null }[]>([]);
  const [destination, setDestination] = useState('');
  const pending = useRef<AbortController | null>(null);
  const logEnd = useRef<HTMLDivElement | null>(null);

  const playerId = playerOf(module);
  const scene = sceneOf(module, save);
  const destinations = useMemo(() => destinationsFrom(module, save.values, playerId, scene.place.id), [module, save.values, playerId, scene.place.id]);
  const latest = lastTurn(save);

  useEffect(() => { onChange(save); }, [save, onChange]);
  useEffect(() => { logEnd.current?.scrollIntoView({ block: 'end' }); }, [save.turns.length, latest?.reply]);
  useEffect(() => () => pending.current?.abort(), []);

  async function runNarration(target: Save) {
    const turn = lastTurn(target);
    if (!turn) return;
    if (!connection.connected) { setNotice('Recorded. Connect NovelAI (top right) to have it narrated.'); return; }
    const messages = compileContext(module, target);
    setLastSent(messages);
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setNotice('');
    try {
      const started = performance.now();
      const result = await narrate(messages, connection.model, connection.mode, controller.signal);
      if (controller.signal.aborted) return;
      setCalls((list) => [{ at: new Date().toLocaleTimeString(), ok: true, ms: Math.round(performance.now() - started), message: `${result.text.length} characters`, diagnostics: result.diagnostics ?? null }, ...list].slice(0, 10));
      setSave((current) => {
        const placed = setReply(current, turn.id, cleanReply(result.text, turn.input));
        return placed.ok ? placed.save : current;
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : 'Narration failed.';
      setNotice(`${message} See Diagnostics below.`);
      setCalls((list) => [{ at: new Date().toLocaleTimeString(), ok: false, ms: 0, message, diagnostics: error instanceof NarrationError ? error.diagnostics : null }, ...list].slice(0, 10));
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }

  function send() {
    const result = say(save, newId(), draft);
    if (!result.ok) { setNotice(result.reason); return; }
    setDraft('');
    setSave(result.save);
    void runNarration(result.save);
  }

  function perform(action: Action) {
    const result = act(module, save, newId(), action);
    if (!result.ok) { setNotice(result.reason); return; }
    setSave(result.save);
    void runNarration(result.save);
  }

  function undo() {
    pending.current?.abort();
    const result = undoLastTurn(save);
    if (!result.ok) { setNotice(result.reason); return; }
    setSave(result.save);
    setDraft(result.turn.kind === 'say' ? result.turn.input : draft);
    setNotice('The last turn was undone.');
  }

  function override(def: StateDef, value: number) {
    const result = setState(module, save, def.id, playerId, value);
    if (!result.ok) { setNotice(result.reason); return; }
    setSave(result.save);
    const terminal = result.terminals[0];
    setNotice(terminal ? `${def.name} set to ${value}. ${terminal.note}` : `${def.name} set to ${value}.`);
  }

  const playerStates = module.ruleset.states
    .filter((def) => appliesTo(def, 'character', true))
    .map((def) => stateDefFor(module, def.id, playerId) ?? def);

  return (
    <main className="play">
      <header className="scene-head">
        <div>
          <h2>{scene.place.name}</h2>
          <p className="muted">{scene.stamp} · {scene.date} · {scene.timeBand}</p>
        </div>
        <button type="button" onClick={onClose}>Saves</button>
      </header>

      <section className="log" aria-live="polite" aria-label="Story">
        {module.scenario.opening && <RichText text={module.scenario.opening} />}
        {save.turns.map((turn) => (
          <article key={turn.id} className={`turn ${turn.kind}`}>
            <p className="said">{turn.input}</p>
            {turn.reply ? <RichText text={turn.reply} /> : turn === latest && busy ? <p className="muted">The narrator is writing…</p> : null}
          </article>
        ))}
        <div ref={logEnd} />
      </section>

      <section className="composer">
        {notice && <p className="notice" role="status">{notice}</p>}
        <textarea
          value={draft}
          rows={2}
          placeholder="What do you do or say?"
          aria-label="What you do or say"
          onChange={(event: { target: HTMLTextAreaElement }) => setDraft(event.target.value)}
          onKeyDown={(event: { key: string; ctrlKey: boolean; metaKey: boolean; preventDefault: () => void }) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); send(); }
          }}
        />
        <div className="inline">
          <button type="button" className="primary" onClick={send} disabled={busy || !draft.trim()}>Send</button>
          <button type="button" onClick={() => void runNarration(save)} disabled={busy || !latest || !connection.connected}>
            {latest?.reply ? 'Reroll' : 'Narrate'}
          </button>
          <button type="button" onClick={undo} disabled={!latest}>Undo turn</button>
          {busy && <button type="button" onClick={() => { pending.current?.abort(); setBusy(false); }}>Stop</button>}
        </div>
      </section>

      {!connection.connected && (
        <section className="card">
          <p>Narration is off. Connect your NovelAI account to have turns narrated.</p>
          <button type="button" className="primary" onClick={onConnect}>Connect NovelAI</button>
        </section>
      )}

      <details className="card" open>
        <summary>Here and ways out</summary>
        {scene.present.length ? (
          <ul className="rows">
            {scene.present.map((character) => (
              <li key={character.id}>
                <span>{character.name}</span>
                <span className="muted">{typeof character.role === 'string' ? character.role : ''}</span>
              </li>
            ))}
          </ul>
        ) : <p className="muted">Nobody else is here.</p>}
        <ul className="exits">
          {scene.exits.map((exit) => (
            <li key={`${exit.edge.kind}:${exit.edge.routeId ?? exit.place.id}`}>
              <button type="button" onClick={() => perform({ type: 'travel', to: exit.place.id })} disabled={Boolean(exit.blocked) || busy}>
                <span>{exit.place.name}</span>
                <span className="muted">{durationWords(exit.edge.minutes)}</span>
              </button>
              {exit.blocked && <p className="blocked">{exit.blocked}</p>}
            </li>
          ))}
        </ul>
        <div className="inline">
          <select value={destination} onChange={(event: { target: HTMLSelectElement }) => setDestination(event.target.value)} aria-label="Destination">
            <option value="">Go further…</option>
            {destinations.map(({ place, result }) => (
              <option key={place.id} value={place.id}>
                {place.name}{result.ok ? `, ${durationWords(result.minutes)}` : ' (closed)'}
              </option>
            ))}
          </select>
          <button type="button" disabled={!destination || busy} onClick={() => { perform({ type: 'travel', to: destination }); setDestination(''); }}>Go</button>
        </div>
        <div className="inline">
          <span className="muted">Wait</span>
          {[15, 60, 480].map((minutes) => (
            <button key={minutes} type="button" disabled={busy} onClick={() => perform({ type: 'wait', minutes })}>{durationWords(minutes)}</button>
          ))}
        </div>
      </details>

      <details className="card">
        <summary>{module.characters.find((character) => character.id === playerId)?.name ?? 'You'}</summary>
        <p className="muted">Every value can be set by hand. Changes are recorded as yours.</p>
        <StateRows defs={playerStates} values={save.values} owner={playerId} onSet={override} />
      </details>

      <details className="card">
        <summary>Diagnostics</summary>
        <p className="muted">The last ten narration calls, newest first: what NovelAI sent back, without your token.</p>
        {calls.length ? (
          <ol className="sent">
            {calls.map((call, index) => (
              <li key={index}>
                <span className={call.ok ? 'muted' : 'bad'}>{call.at} · {call.ok ? `ok, ${call.ms} ms` : 'failed'} · {call.message}</span>
                {call.diagnostics && <pre>{JSON.stringify(call.diagnostics, null, 2)}</pre>}
              </li>
            ))}
          </ol>
        ) : <p className="muted">No calls yet this session.</p>}
        <button type="button" onClick={() => void navigator.clipboard?.writeText(JSON.stringify(calls, null, 2))} disabled={!calls.length}>Copy diagnostics</button>
      </details>

      <details className="card">
        <summary>What the narrator was sent</summary>
        {lastSent ? (
          <ol className="sent">
            {lastSent.map((message, index) => (
              <li key={index}><span className="muted">{message.role}</span><pre>{message.content}</pre></li>
            ))}
          </ol>
        ) : <p className="muted">Nothing yet this session.</p>}
      </details>

      <details className="card">
        <summary>Ledger</summary>
        {save.ledger.length ? (
          <ol className="ledger" reversed>
            {save.ledger.slice(-20).reverse().map((entry, index) => <li key={save.ledger.length - index}>{describe(module, entry)}</li>)}
          </ol>
        ) : <p className="muted">Nothing has changed yet.</p>}
      </details>

      <div className="inline">
        <button type="button" onClick={() => downloadJson(`${fileSafe(name)}.praxis.json`, exportSave(module, save, name))}>Export this save</button>
      </div>
    </main>
  );
}

function describe(module: PraxisModule, entry: LedgerEntry): string {
  const by = entry.source === 'player' ? ' (set by hand)' : '';
  const placeName = (id: string | null) => (id === null ? 'nowhere' : module.world.places.find((place) => place.id === id)?.name ?? id);
  const characterName = (id: string) => module.characters.find((character) => character.id === id)?.name ?? id;
  switch (entry.kind) {
    case 'move':
      return `${characterName(entry.characterId)}: ${placeName(entry.from)} to ${inSentence(placeName(entry.to))}${entry.minutes ? `, ${durationWords(entry.minutes)}` : ''}${by}`;
    case 'clock':
      return entry.to >= entry.from
        ? `${durationWords(entry.to - entry.from)} passed (${entry.reason})${by}`
        : `Clock turned back ${durationWords(entry.from - entry.to)}${by}`;
    case 'state': {
      const def = module.ruleset.states.find((state) => state.id === entry.defId);
      return `${def?.name ?? entry.defId} for ${characterName(entry.owner)}: ${entry.from} to ${entry.to}${by}`;
    }
  }
}
