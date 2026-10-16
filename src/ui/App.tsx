// The title screen (saved games, a new game, importing) and the game itself.
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import abernysRaw from '../../modules/abernys-port-covenant.json';
import { loadModule, readSaveFile, sceneOf, startSave, type PraxisModule, type Save } from '../engine';
import { ConnectForm, reconnect, type Connection } from './Connect';
import { Play } from './Play';
import { readJsonFile } from './files';
import { savedMode, savedModel } from './novelai';
import { usePrefs } from './prefs';
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
  const [connection, setConnection] = useState<Connection>({ connected: false, model: savedModel(), mode: savedMode(), models: [] });
  const [prefs, setPrefs] = usePrefs();

  const refresh = useCallback(async () => {
    try { setSaves(await listSaves()); } catch (error) { setStorageNote(error instanceof Error ? error.message : 'Saved games are unavailable.'); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  // A token remembered on this device connects by itself.
  useEffect(() => { void reconnect(connection).then(setConnection); }, []);

  async function begin(module: PraxisModule, save: Save, name: string, id = newId()) {
    try { await putModule(module); } catch { setStorageNote('This browser is not keeping saves. Export your game to keep it.'); }
    setErrors([]);
    setScreen({ kind: 'play', id, name, module, save });
  }

  function newGame(raw: unknown) {
    const loaded = loadModule(raw);
    if (!loaded.ok) { setErrors(loaded.errors); return; }
    void begin(loaded.module, startSave(loaded.module, Math.floor(Math.random() * 2 ** 31)), loaded.module.name);
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

  if (playing) {
    return (
      <Play
        key={playing.id}
        module={playing.module}
        initial={playing.save}
        name={playing.name}
        connection={connection}
        setConnection={setConnection}
        prefs={prefs}
        setPrefs={setPrefs}
        onChange={persist}
        onClose={() => { setScreen({ kind: 'home' }); void refresh(); }}
      />
    );
  }

  return (
    <main className="home">
      <header className="home-head">
        <div>
          <h1 className="wordmark">Praxis</h1>
          <p className="tagline">A roleplay where the story is yours and the facts are kept.</p>
        </div>
      </header>

      {storageNote && <p className="notice warn">{storageNote}</p>}

      {saves.length > 0 && (
        <section>
          <h2>Continue</h2>
          <div className="card clip">
            {saves.map((record) => (
              <div key={record.id} className="save-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p className="name">{record.name}</p>
                  <p className="meta">{record.place} · {record.stamp} · {record.turns} {record.turns === 1 ? 'turn' : 'turns'}</p>
                  <p className="meta">Saved {new Date(record.updatedAt).toLocaleString()}</p>
                </div>
                <button type="button" className="btn primary" onClick={() => void resume(record)}>Continue</button>
                <button type="button" className="btn quiet" aria-label={`Delete ${record.name}`} onClick={() => void remove(record)}>Delete</button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2>New game</h2>
        <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button type="button" className="btn primary wide" style={{ minHeight: 52, justifyContent: 'flex-start' }} onClick={() => newGame(abernysRaw)}>Abernys: Port Covenant</button>
          <label className="file-pick">
            <span className="meta">Or a module file</span>
            <input type="file" accept="application/json,.json" onChange={(event) => void onModuleFile(event)} />
          </label>
        </div>
      </section>

      <section>
        <h2>Narration</h2>
        <div className="card clip"><ConnectForm connection={connection} onChange={setConnection} /></div>
      </section>

      <section>
        <h2>Import a save</h2>
        <div className="card pad">
          <p className="meta" style={{ lineHeight: 1.45 }}>Saves live in this browser. Clearing its site data deletes them, so export the ones you want to keep.</p>
          <label className="file-pick">
            <span className="meta">A .praxis.json file</span>
            <input type="file" accept="application/json,.json" onChange={(event) => void onSaveFile(event)} />
          </label>
        </div>
      </section>

      {errors.length > 0 && (
        <section aria-live="polite" className="card pad">
          <p className="name">That could not be loaded</p>
          <ul className="errors">{errors.map((line) => <li key={line}>{line}</li>)}</ul>
        </section>
      )}

      <p className="version">{__PRAXIS_VERSION__}</p>
    </main>
  );
}
