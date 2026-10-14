// Development shell: saved games, new games and loading files on one screen; play on another.
// A placeholder until the play interface is designed.
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import abernysRaw from '../../modules/abernys-port-covenant.json';
import { loadModule, readSaveFile, sceneOf, startSave, type PraxisModule, type Save } from '../engine';
import { Connect, type Connection } from './Connect';
import { Play } from './Play';
import { readJsonFile } from './files';
import { savedModel } from './novelai';
import { deleteSave, listSaves, moduleKey, openSave, putModule, putSave, type SaveRecord } from './storage';

type Screen =
  | { kind: 'home' }
  | { kind: 'play'; id: string; name: string; module: PraxisModule; save: Save };

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `s${Date.now()}${Math.random().toString(16).slice(2)}`;
}

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'home' });
  const [saves, setSaves] = useState<SaveRecord[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [storageNote, setStorageNote] = useState('');
  const [connection, setConnection] = useState<Connection>({ connected: false, model: savedModel() });
  const [showConnect, setShowConnect] = useState(false);

  const refresh = useCallback(async () => {
    try { setSaves(await listSaves()); } catch (error) { setStorageNote(error instanceof Error ? error.message : 'Saved games are unavailable.'); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function begin(module: PraxisModule, save: Save, name: string, id = newId()) {
    try { await putModule(module); } catch { setStorageNote('This browser is not keeping saves. Export your game to keep it.'); }
    setErrors([]);
    setScreen({ kind: 'play', id, name, module, save });
  }

  function newGame(raw: unknown) {
    const loaded = loadModule(raw);
    if (!loaded.ok) { setErrors(loaded.errors); return; }
    void begin(loaded.module, startSave(loaded.module), loaded.module.name);
  }

  async function onModuleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const read = await readJsonFile(file);
    if (!read.ok) { setErrors([read.error]); return; }
    newGame(read.data);
  }

  async function onSaveFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const read = await readJsonFile(file);
    if (!read.ok) { setErrors([read.error]); return; }
    const parsed = readSaveFile(read.data);
    if (!parsed.ok) { setErrors(parsed.errors); return; }
    void begin(parsed.module, parsed.save, parsed.name);
  }

  async function resume(record: SaveRecord) {
    const opened = await openSave(record);
    if (!opened.ok) { setErrors(opened.errors); return; }
    void begin(opened.module, opened.save, record.name, record.id);
  }

  async function remove(record: SaveRecord) {
    if (!window.confirm(`Delete "${record.name}" from this browser? Export it first if you want to keep it.`)) return;
    await deleteSave(record.id).catch(() => undefined);
    void refresh();
  }

  // Autosave. Kept stable so Play's effect runs once per change, not once per render.
  const playing = screen.kind === 'play' ? screen : null;
  const target = useRef(playing);
  target.current = playing;
  const persist = useCallback((save: Save) => {
    const current = target.current;
    if (!current) return;
    const scene = sceneOf(current.module, save);
    putSave({
      id: current.id,
      name: current.name,
      moduleKey: moduleKey(current.module),
      moduleName: current.module.name,
      updatedAt: Date.now(),
      place: scene.place.name,
      stamp: scene.stamp,
      turns: save.turns.length,
      save,
    }).catch(() => setStorageNote('This browser is not keeping saves. Export your game to keep it.'));
  }, []);

  return (
    <div className="shell">
      <header className="shell-head">
        <h1>Praxis</h1>
        <button type="button" className={connection.connected ? 'status on' : 'status'} aria-expanded={showConnect} onClick={() => setShowConnect((open) => !open)}>
          {connection.connected ? `NovelAI · ${connection.model}` : 'Connect NovelAI'}
        </button>
      </header>
      {showConnect && (
        <section className="card connect-panel">
          <Connect connection={connection} onChange={(next) => { setConnection(next); if (next.connected) setShowConnect(false); }} />
        </section>
      )}
      {storageNote && <p className="notice">{storageNote}</p>}
      {playing ? (
        <Play
          key={playing.id}
          module={playing.module}
          initial={playing.save}
          name={playing.name}
          connection={connection}
          onConnect={() => { setShowConnect(true); window.scrollTo({ top: 0 }); }}
          onChange={persist}
          onClose={() => { setScreen({ kind: 'home' }); void refresh(); }}
        />
      ) : (
        <main className="shell-body">
          {saves.length > 0 && (
            <section className="card">
              <h2>Continue</h2>
              <ul className="saves">
                {saves.map((record) => (
                  <li key={record.id}>
                    <div>
                      <strong>{record.name}</strong>
                      <p className="muted">{record.place} · {record.stamp} · {record.turns} {record.turns === 1 ? "turn" : "turns"} · saved {new Date(record.updatedAt).toLocaleString()}</p>
                    </div>
                    <div className="inline">
                      <button type="button" className="primary" onClick={() => void resume(record)}>Continue</button>
                      <button type="button" onClick={() => void remove(record)}>Delete</button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="card">
            <h2>New game</h2>
            <button type="button" className="primary" onClick={() => newGame(abernysRaw)}>Abernys: Port Covenant</button>
            <label className="file">
              <span className="muted">Or a module file</span>
              <input type="file" accept="application/json,.json" onChange={onModuleFile} />
            </label>
          </section>
          <section className="card">
            <h2>Import a save</h2>
            <p className="muted">Saves live in this browser. Clearing its site data deletes them, so export the ones you want to keep.</p>
            <label className="file">
              <span className="muted">A .praxis.json file</span>
              <input type="file" accept="application/json,.json" onChange={onSaveFile} />
            </label>
          </section>
          {errors.length > 0 && (
            <section aria-live="polite">
              <h2>That could not be loaded</h2>
              <ul className="errors">{errors.map((line) => <li key={line}>{line}</li>)}</ul>
            </section>
          )}
        </main>
      )}
      <p className="muted version">{__PRAXIS_VERSION__}</p>
    </div>
  );
}
