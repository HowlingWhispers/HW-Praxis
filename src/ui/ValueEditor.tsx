// Setting one value by hand. The change is the player's, and the ledger says so.
import { useEffect, useState } from 'react';
import { band, type StateDef } from '../engine';

export function ValueEditor({ def, value, onSet }: { def: StateDef; value: number; onSet: (value: number) => void }) {
  const lo = Math.min(def.min, def.max);
  const hi = Math.max(def.min, def.max);
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const reading = band(def, value);
  const commit = () => {
    const next = Math.round(Number(text));
    if (Number.isFinite(next) && next !== value) onSet(next);
    else setText(String(value));
  };
  return (
    <div className="stepper">
      <span style={{ width: 100, flex: 'none', fontSize: 15, fontWeight: 600 }}>{def.name}</span>
      <button type="button" className="btn square" aria-label={`Lower ${def.name}`} disabled={value <= lo} onClick={() => onSet(value - 1)}>−</button>
      <input
        aria-label={def.name}
        className="field mono"
        inputMode="numeric"
        style={{ width: 64, minHeight: 44, padding: '0 6px', textAlign: 'center' }}
        value={text}
        onChange={(event) => setText(event.target.value.replace(/[^\d-]/g, ''))}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') commit(); }}
      />
      <button type="button" className="btn square" aria-label={`Raise ${def.name}`} disabled={value >= hi} onClick={() => onSet(value + 1)}>+</button>
      <span className="meta">{lo} to {hi}{reading.banded ? ` · ${reading.short}` : ''}</span>
    </div>
  );
}
