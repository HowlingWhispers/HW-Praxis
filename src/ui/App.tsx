// Development shell: load a module and play it without a model. Everything here calls the
// engine; nothing here decides a rule. A placeholder until the play interface is designed.
import { useMemo, useState, type ChangeEvent } from 'react';
import abernysRaw from '../../modules/abernys-port-covenant.json';
import {
  appliesTo, band, destinationsFrom, durationWords, loadModule, playerOf, read, sceneOf, setState, startSave, travel, wait,
  type ActionResult, type LedgerEntry, type PraxisModule, type Save, type StateDef,
} from '../engine';
import { RichText } from './RichText';

type Loaded =
  | { status: 'empty' }
  | { status: 'error'; label: string; errors: string[] }
  | { status: 'ready'; module: PraxisModule };

export function App() {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'empty' });

  function load(label: string, raw: unknown) {
    const result = loadModule(raw);
    setLoaded(result.ok ? { status: 'ready', module: result.module } : { status: 'error', label, errors: result.errors });
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      load(file.name, JSON.parse(await file.text()));
    } catch {
      setLoaded({ status: 'error', label: file.name, errors: ['The file is not valid JSON.'] });
    }
  }

  return (
    <div className="shell">
      <header className="shell-head">
        <h1>Praxis</h1>
        <span className="muted">{__PRAXIS_VERSION__}</span>
      </header>
      {loaded.status === 'ready' ? (
        <Play key={loaded.module.id} module={loaded.module} onClose={() => setLoaded({ status: 'empty' })} />
      ) : (
        <main className="shell-body">
          <section className="card">
            <h2>Load a module</h2>
            <button type="button" className="primary" onClick={() => load('Abernys: Port Covenant', abernysRaw)}>Abernys: Port Covenant</button>
            <label className="file">
              <span className="muted">Or a module file</span>
              <input type="file" accept="application/json,.json" onChange={onFile} />
            </label>
          </section>
          {loaded.status === 'error' && (
            <section aria-live="polite">
              <h2>{loaded.label} could not be loaded</h2>
              <ul className="errors">{loaded.errors.map((line) => <li key={line}>{line}</li>)}</ul>
            </section>
          )}
        </main>
      )}
    </div>
  );
}

function Play({ module, onClose }: { module: PraxisModule; onClose: () => void }) {
  const [save, setSave] = useState<Save>(() => startSave(module));
  const [notice, setNotice] = useState<string>('');
  const playerId = playerOf(module);
  const scene = sceneOf(module, save);
  const destinations = useMemo(() => destinationsFrom(module, save.values, playerId, scene.place.id), [module, save.values, playerId, scene.place.id]);
  const [destination, setDestination] = useState('');

  function apply(result: ActionResult, success: string) {
    if (!result.ok) { setNotice(result.reason); return; }
    setSave(result.save);
    const terminal = result.terminals[0];
    setNotice(terminal ? `${success} ${terminal.note}` : success);
  }

  function go(placeId: string) {
    const name = module.world.places.find((place) => place.id === placeId)?.name ?? placeId;
    const result = travel(module, save, placeId);
    const move = result.ok ? result.entries.find((entry): entry is Extract<LedgerEntry, { kind: 'move' }> => entry.kind === 'move') : undefined;
    const minutes = move?.minutes ?? 0;
    apply(result, `You reach ${name} after ${durationWords(minutes)}.`);
  }

  const playerStates = module.ruleset.states.filter((def) => appliesTo(def, 'character', true));

  return (
    <main className="shell-body">
      <section className="scene">
        <h2>{scene.place.name}</h2>
        <p className="muted">{scene.stamp} · {scene.date} · {scene.timeBand}</p>
        <p>{scene.place.description}</p>
        {save.ledger.length === 0 && module.scenario.opening && <RichText text={module.scenario.opening} />}
        {notice && <p className="notice" role="status">{notice}</p>}
      </section>

      <section className="card">
        <h3>Here</h3>
        {scene.present.length ? (
          <ul className="rows">
            {scene.present.map((character) => (
              <li key={character.id}>
                <span>{character.name}</span>
                <span className="muted">{typeof character.role === 'string' ? character.role : ''}</span>
              </li>
            ))}
          </ul>
        ) : <p className="muted">Nobody else.</p>}
      </section>

      <section className="card">
        <h3>Ways out</h3>
        <ul className="exits">
          {scene.exits.map((exit) => (
            <li key={`${exit.edge.kind}:${exit.edge.routeId ?? exit.place.id}`}>
              <button type="button" onClick={() => go(exit.place.id)} disabled={Boolean(exit.blocked)}>
                <span>{exit.place.name}</span>
                <span className="muted">{durationWords(exit.edge.minutes)}</span>
              </button>
              {exit.blocked && <p className="blocked">{exit.blocked}</p>}
            </li>
          ))}
        </ul>
        <div className="inline">
          <select value={destination} onChange={(event) => setDestination(event.target.value)} aria-label="Destination">
            <option value="">Go further…</option>
            {destinations.map(({ place, result }) => (
              <option key={place.id} value={place.id}>
                {place.name}{result.ok ? `, ${durationWords(result.minutes)}` : ' (closed)'}
              </option>
            ))}
          </select>
          <button type="button" disabled={!destination} onClick={() => { go(destination); setDestination(''); }}>Go</button>
        </div>
        <div className="inline">
          <span className="muted">Wait</span>
          {[15, 60, 480].map((minutes) => (
            <button key={minutes} type="button" onClick={() => apply(wait(save, minutes), `${durationWords(minutes)} pass.`)}>
              {durationWords(minutes)}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>{module.characters.find((character) => character.id === playerId)?.name}</h3>
        <p className="muted">Every value can be set by hand. Changes are recorded as yours.</p>
        <StateRows
          defs={playerStates}
          values={save.values}
          owner={playerId}
          onSet={(def, value) => apply(setState(module, save, def.id, playerId, value), `${def.name} set to ${value}.`)}
        />
      </section>

      <section className="card">
        <h3>Ledger</h3>
        {save.ledger.length ? (
          <ol className="ledger" reversed>
            {save.ledger.slice(-12).reverse().map((entry, index) => <li key={save.ledger.length - index}>{describe(module, entry)}</li>)}
          </ol>
        ) : <p className="muted">Nothing has changed yet.</p>}
        <button type="button" onClick={onClose}>Close this module</button>
      </section>
    </main>
  );
}

function StateRows({ defs, values, owner, onSet }: {
  defs: StateDef[];
  values: Save['values'];
  owner: string;
  onSet: (def: StateDef, value: number) => void;
}) {
  const groups = new Map<string, StateDef[]>();
  for (const def of defs) {
    const key = def.category ?? '';
    groups.set(key, [...(groups.get(key) ?? []), def]);
  }
  return (
    <>
      {[...groups].map(([category, list]) => (
        <div key={category || 'other'}>
          {category && <h4>{category}</h4>}
          <ul className="rows">
            {list.map((def) => {
              const value = read(values, def, owner);
              const reading = band(def, value);
              return (
                <li key={def.id}>
                  <span>
                    {def.name}
                    {reading.banded && <span className="muted"> · {reading.label}</span>}
                    {def.display === 'hidden' && <span className="muted"> · hidden in play</span>}
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    aria-label={def.name}
                    min={Math.min(def.min, def.max)}
                    max={Math.max(def.min, def.max)}
                    value={value}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      if (event.target.value !== '' && Number.isFinite(next)) onSet(def, next);
                    }}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );
}

function describe(module: PraxisModule, entry: LedgerEntry): string {
  const by = entry.source === 'player' ? ' (set by hand)' : '';
  const placeName = (id: string | null) => (id === null ? 'nowhere' : module.world.places.find((place) => place.id === id)?.name ?? id);
  const characterName = (id: string) => module.characters.find((character) => character.id === id)?.name ?? id;
  switch (entry.kind) {
    case 'move':
      return `${characterName(entry.characterId)}: ${placeName(entry.from)} to ${placeName(entry.to)}${entry.minutes ? `, ${durationWords(entry.minutes)}` : ''}${by}`;
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
