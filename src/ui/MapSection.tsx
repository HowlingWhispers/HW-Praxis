// Map: the ways out as a schematic around where you stand, the journeys further afield, and
// putting yourself anywhere by hand.
import { useMemo, useState } from 'react';
import { destinationsFrom, durationWords, isArea, playerOf, sceneOf, type Exit } from '../engine';
import type { PlayApi } from './Play';
import { ChevronRight, LockIcon } from './icons';

const W = 360;
const H = 296;
const CX = W / 2;
const CY = 124;

function layout(exits: Exit[]): { exit: Exit; x: number; y: number }[] {
  if (!exits.length) return [];
  const longest = Math.max(...exits.map((exit) => exit.edge.minutes), 1);
  return exits.map((exit, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / exits.length + (exits.length === 2 ? Math.PI / 4 : 0);
    const scale = 0.42 + 0.58 * (Math.log1p(exit.edge.minutes) / Math.log1p(longest));
    const x = Math.min(W - 72, Math.max(72, CX + Math.cos(angle) * 118 * scale));
    const y = Math.min(H - 64, Math.max(26, CY + Math.sin(angle) * 98 * scale));
    return { exit, x, y };
  });
}

const pct = (value: number, of: number) => `${(value / of) * 100}%`;

export function MapSection({ api }: { api: PlayApi }) {
  const { world, save, busy } = api;
  const scene = sceneOf(world, save);
  const playerId = playerOf(world);
  const [selected, setSelected] = useState<string | null>(null);
  const [handPlace, setHandPlace] = useState('');
  const nodes = layout(scene.exits);
  const chosen = scene.exits.find((exit) => exit.place.id === selected) ?? null;

  const further = useMemo(() => {
    const near = new Set(scene.exits.map((exit) => exit.place.id));
    return destinationsFrom(world, save.values, playerId, scene.place.id)
      .filter((entry) => !near.has(entry.place.id))
      .map((entry) => ({ ...entry, minutes: entry.result.ok ? entry.result.minutes : Infinity }))
      .sort((a, b) => a.minutes - b.minutes || a.place.name.localeCompare(b.place.name));
  }, [world, save.values, playerId, scene.place.id, scene.exits]);
  const reachable = further.filter((entry) => entry.result.ok);
  const unreachable = further.length - reachable.length;
  const everywhere = world.world.places.filter((place) => !isArea(place) && place.id !== scene.place.id).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <div className="map" role="group" aria-label="Ways out from here">
        <svg aria-hidden="true" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {nodes.map(({ exit, x, y }) => (
            <line key={exit.place.id} x1={CX} y1={CY} x2={x} y2={y} stroke={exit.blocked ? '#e8907e' : '#4a5160'} strokeWidth={2} strokeDasharray={exit.blocked ? '5 5' : undefined} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        {nodes.map(({ exit, x, y }) => (
          <span key={`pin-${exit.place.id}`} aria-hidden="true" style={{ position: 'absolute', left: pct(x, W), top: pct(y, H), width: 12, height: 12, margin: '-6px 0 0 -6px', borderRadius: '50%', background: exit.blocked ? '#151922' : 'var(--text)', boxShadow: exit.blocked ? '0 0 0 2px #e8907e' : '0 0 0 3px #12161e' }} />
        ))}
        <span aria-hidden="true" style={{ position: 'absolute', left: pct(CX, W), top: pct(CY, H), width: 18, height: 18, margin: '-9px 0 0 -9px', borderRadius: '50%', background: 'var(--you)', boxShadow: '0 0 0 4px #12161e, 0 0 0 6px var(--you-line)' }} />
        <span className="node here" style={{ left: pct(CX, W), top: `calc(${pct(CY, H)} + 14px)` }}>{scene.place.name}<span className="t">you are here</span></span>
        {nodes.map(({ exit, x, y }) => (
          <button
            key={`node-${exit.place.id}`}
            type="button"
            className={`node${exit.blocked ? ' closed' : ''}`}
            style={{ left: pct(x, W), top: `calc(${pct(y, H)} + 9px)` }}
            aria-pressed={selected === exit.place.id}
            onClick={() => setSelected(selected === exit.place.id ? null : exit.place.id)}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>{exit.blocked && <LockIcon size={13} />}{exit.place.name}</span>
            <span className="t">{durationWords(exit.edge.minutes)}</span>
          </button>
        ))}
      </div>
      <p className="hint">Schematic, not to scale: nearer the middle is quicker. Dashed is closed. Times are on foot.</p>

      {chosen && (
        <div className="card pad" style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span className="name" style={{ flex: 1 }}>{chosen.place.name}</span>
            <span className="mono meta">{durationWords(chosen.edge.minutes)}</span>
          </div>
          {chosen.place.description && <p className="prose">{chosen.place.description}</p>}
          {chosen.edge.terrain && <p className="meta">By {chosen.edge.terrain}</p>}
          {chosen.blocked ? (
            <>
              <p style={{ fontSize: 14, color: 'var(--bad)' }}>{chosen.blocked}</p>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <button type="button" className="btn" onClick={() => api.putSelf(chosen.place.id)}>Go anyway</button>
                <span className="meta" style={{ lineHeight: 1.35 }}>Recorded as yours, not the rules’. No time passes.</span>
              </div>
            </>
          ) : (
            <button type="button" className="btn primary" disabled={busy} onClick={() => api.perform({ type: 'travel', to: chosen.place.id })}>Go</button>
          )}
        </div>
      )}

      <div className="sub"><p className="label">From here</p><span className="meta">quickest first</span></div>
      <div className="card">
        {scene.exits.length === 0 && <div className="lr"><span className="meta">No known way out.</span></div>}
        {scene.exits.map((exit) => (
          <div key={`${exit.edge.kind}:${exit.edge.routeId ?? exit.place.id}`} className="lr" style={{ alignItems: exit.blocked ? 'flex-start' : 'center' }}>
            <span className="grow">
              <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                {exit.blocked && <span style={{ color: 'var(--bad)' }}><LockIcon /></span>}
                <span className="name">{exit.place.name}</span>
              </span>
              <span className="meta" style={{ display: 'block', marginTop: 2 }}>{[exit.place.kind !== 'other' ? capitalise(exit.place.kind) : '', exit.edge.terrain].filter(Boolean).join(' · ')}</span>
              {exit.blocked && (
                <>
                  <span style={{ display: 'block', marginTop: 8, fontSize: 14, lineHeight: 1.4, color: 'var(--bad)' }}>{exit.blocked}</span>
                  <span style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
                    <button type="button" className="btn" onClick={() => api.putSelf(exit.place.id)}>Go anyway</button>
                    <span className="meta" style={{ lineHeight: 1.35 }}>Recorded as yours,<br />not the rules’.</span>
                  </span>
                </>
              )}
            </span>
            <span className="mono meta" style={{ textAlign: 'right' }}>{durationWords(exit.edge.minutes)}</span>
            {!exit.blocked && <button type="button" className="btn" disabled={busy} onClick={() => api.perform({ type: 'travel', to: exit.place.id })}>Go</button>}
          </div>
        ))}
      </div>

      {further.length > 0 && (
        <details className="card clip" style={{ marginTop: 12 }}>
          <summary className="row" style={{ minHeight: 56 }}>
            <span className="row-text">
              <span className="name">Further away</span>
              <span className="meta">{[reachable.length ? `${reachable.length} you can reach` : '', unreachable ? `${unreachable} closed for now` : ''].filter(Boolean).join(', ')}</span>
            </span>
            <ChevronRight />
          </summary>
          <div>
            {further.map(({ place, result }) => (
              <div key={place.id} className="lr">
                <span className="grow">
                  <span className="name" style={{ display: 'block' }}>{place.name}</span>
                  {!result.ok && <span className="meta" style={{ display: 'block', marginTop: 2 }}>{result.reason}</span>}
                </span>
                {result.ok && <span className="mono meta">{durationWords(result.minutes)}</span>}
                {result.ok && <button type="button" className="btn" disabled={busy} onClick={() => api.perform({ type: 'travel', to: place.id })}>Go</button>}
              </div>
            ))}
          </div>
        </details>
      )}

      <details className="card clip" style={{ marginTop: 12 }}>
        <summary className="row" style={{ minHeight: 56 }}>
          <span className="row-text">
            <span className="name">Put yourself somewhere by hand</span>
            <span className="meta">No travel and no time. Recorded as yours.</span>
          </span>
          <ChevronRight />
        </summary>
        <div className="row-body">
          <label htmlFor="hand-place" className="sr">Place</label>
          <select id="hand-place" className="select" value={handPlace} onChange={(event) => setHandPlace(event.target.value)}>
            <option value="">Choose a place…</option>
            {everywhere.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}
          </select>
          <button type="button" className="btn" disabled={!handPlace} onClick={() => { api.putSelf(handPlace); setHandPlace(''); }}>Move there</button>
        </div>
      </details>
    </>
  );
}

function capitalise(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}
