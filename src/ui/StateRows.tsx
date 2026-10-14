// One owner's states, grouped by the author's categories, each editable by hand.
import { band, read, type StateDef, type StateValues } from '../engine';

export function StateRows({ defs, values, owner, onSet }: {
  defs: StateDef[];
  values: StateValues;
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
                    onChange={(event: { target: HTMLInputElement }) => {
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
