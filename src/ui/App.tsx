// Development shell: load a module file and inspect what the engine sees.
// A placeholder until the play interface is designed; it exists to exercise the loader.
import { useState, type ChangeEvent } from 'react';
import { appliesTo, band, loadModule, read, type PraxisModule } from '../engine';

type Loaded =
  | { status: 'empty' }
  | { status: 'error'; fileName: string; errors: string[] }
  | { status: 'ready'; fileName: string; module: PraxisModule };

export function App() {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'empty' });

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      setLoaded({ status: 'error', fileName: file.name, errors: ['The file is not valid JSON.'] });
      return;
    }
    const result = loadModule(raw);
    setLoaded(result.ok
      ? { status: 'ready', fileName: file.name, module: result.module }
      : { status: 'error', fileName: file.name, errors: result.errors });
  }

  return (
    <div className="shell">
      <header className="shell-head">
        <h1>Praxis</h1>
        <span className="muted">{__PRAXIS_VERSION__}</span>
      </header>
      <main className="shell-body">
        <label className="file">
          <span>Load a module</span>
          <input type="file" accept="application/json,.json" onChange={onFile} />
        </label>
        {loaded.status === 'error' && (
          <section aria-live="polite">
            <h2>{loaded.fileName} could not be loaded</h2>
            <ul className="errors">{loaded.errors.map((line) => <li key={line}>{line}</li>)}</ul>
          </section>
        )}
        {loaded.status === 'ready' && <ModuleSummary module={loaded.module} />}
      </main>
    </div>
  );
}

function ModuleSummary({ module }: { module: PraxisModule }) {
  const { scenario, world } = module;
  const place = world.places.find((entry) => entry.id === scenario.startPlaceId);
  const player = module.characters.find((entry) => entry.id === scenario.playerCharacterId);
  const playerStates = module.ruleset.states.filter((def) => appliesTo(def, 'character', true));

  return (
    <section>
      <h2>{module.name}</h2>
      <dl className="facts">
        <dt>World</dt><dd>{world.name}</dd>
        <dt>Scenario</dt><dd>{scenario.title}</dd>
        <dt>Starts at</dt><dd>{place?.name}</dd>
        <dt>Playing as</dt><dd>{player?.name}</dd>
        <dt>Records</dt>
        <dd>{world.places.length} places, {module.characters.length} characters, {module.items.length} items, {module.ruleset.states.length} states</dd>
      </dl>
      {playerStates.length > 0 && (
        <>
          <h3>{player?.name}'s starting states</h3>
          <ul className="states">
            {playerStates.map((def) => {
              const value = read({}, def, scenario.playerCharacterId);
              const reading = band(def, value);
              return (
                <li key={def.id}>
                  <span>{def.name}</span>
                  <span className="muted">{value}{reading.banded ? `, ${reading.label}` : ''}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
