// You: condition, the journal, approaches, momentum, standing and what you carry.
import { activeEntries, band, chargesOf, discardPending, keepPending, playerOf, read, thingsHeldBy, type StateDef } from '../engine';
import type { PlayApi } from './Play';
import { ChevronRight, PenIcon } from './icons';
import { DraftTag, Pips, StateBar, bandForYou, characterStates, initials, newId } from './shared';
import { ValueEditor } from './ValueEditor';

export function YouSection({ api }: { api: PlayApi }) {
  const { world, save, prefs } = api;
  const playerId = playerOf(world);
  const player = world.characters.find((character) => character.id === playerId);
  if (!player) return null;
  const defs = characterStates(world, player, true);
  const byCategory = (name: string) => defs.filter((def) => (def.category ?? '') === name);
  const approaches = byCategory('Approaches');
  const momentum = byCategory('Momentum');
  const standing = byCategory('Standing');
  const known = new Set([...approaches, ...momentum, ...standing].map((def) => def.id));
  const condition = defs.filter((def) => !known.has(def.id));
  const value = (def: StateDef) => read(save.values, def, playerId);
  const carried = thingsHeldBy(world, save, playerId);
  const charges = chargesOf(world, save, playerId);

  return (
    <>
      <div className="card pad" style={{ display: 'flex', gap: 14 }}>
        <span className="av big yours" aria-hidden="true">{initials(player.name)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h3 style={{ flex: 1, font: '600 22px/1.2 var(--read)' }}>{player.name}</h3>
            <DraftTag record={player} show={prefs.showDrafts} />
          </div>
          {player.description && <p className="prose" style={{ marginTop: 6 }}>{player.description}</p>}
        </div>
      </div>

      {condition.length > 0 && (
        <>
          <div className="sub"><p className="label">Condition</p><span className="meta">tap to set by hand</span></div>
          <div className="card clip rows">
            {condition.map((def) => (
              <details key={def.id}>
                <summary className="row" style={{ minHeight: 56 }}>
                  <span style={{ width: 64, flex: 'none', fontSize: 15, fontWeight: 600 }}>{def.name}</span>
                  <StateBar def={def} value={value(def)} />
                  <span style={{ width: 96, flex: 'none', fontSize: 14 }}>{band(def, value(def)).banded ? band(def, value(def)).label.replace(/^is /, '') : value(def)}</span>
                  <ChevronRight />
                </summary>
                <div className="row-body">
                  <ValueEditor def={def} value={value(def)} onSet={(next) => api.setValue(def.id, playerId, next)} />
                  {def.terminals.length > 0 && <p className="meta" style={{ lineHeight: 1.45 }}>{def.terminals.map((terminal) => terminal.note).join(' ')}</p>}
                  <p className="meta" style={{ lineHeight: 1.45, color: 'var(--text-2)' }}>A change you make here is recorded in the ledger as yours, not the rules’.</p>
                </div>
              </details>
            ))}
          </div>
        </>
      )}

      <JournalSummary api={api} />

      {approaches.length > 0 && (
        <>
          <div className="sub"><p className="label">Approaches</p><button type="button" className="link" onClick={() => api.open('guide')}>How approaches work</button></div>
          <div className="card clip rows">
            {approaches.map((def) => (
              <details key={def.id}>
                <summary className="row" style={{ minHeight: 60 }}>
                  <span className="appr-name" style={{ color: `var(--${def.id}, var(--text))` }}>{def.name}</span>
                  <Pips def={def} value={value(def)} />
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 5 }}>
                    {(charges.find((entry) => entry.approach === def.id)?.slots ?? []).map((slot) => (
                      <span key={slot.value} className={`charge${slot.spent ? ' spent' : ''}`} aria-label={`+${slot.value} charge${slot.spent ? ', spent' : ''}`}>+{slot.value}</span>
                    ))}
                  </span>
                  <ChevronRight />
                </summary>
                <div className="row-body">
                  <ValueEditor def={def} value={value(def)} onSet={(next) => api.setValue(def.id, playerId, next)} />
                </div>
              </details>
            ))}
            <p className="meta" style={{ padding: '12px 14px 14px', lineHeight: 1.5, color: 'var(--text-2)' }}>
              Force pays in Health and noise, Finesse in Alert, Focus in time, Flair in Strain. A spent charge comes back when every charge on that approach is used, or after a full rest.
            </p>
          </div>
        </>
      )}

      {momentum.length > 0 && (
        <>
          <div className="sub"><p className="label">Momentum</p></div>
          <div className="card clip rows">
            {momentum.map((def) => <MomentumRow key={def.id} def={def} value={value(def)} onSet={(next) => api.setValue(def.id, playerId, next)} />)}
          </div>
        </>
      )}

      {standing.length > 0 && (
        <>
          <div className="sub"><p className="label">Standing</p></div>
          <div className="card clip rows">
            {standing.map((def) => (
              <details key={def.id}>
                <summary className="row" style={{ minHeight: 56 }}>
                  <span className="prose-strong" style={{ flex: 1 }}>{band(def, value(def)).banded ? `You ${bandForYou(band(def, value(def)).label)}.` : `${def.name}: ${value(def)}`}</span>
                  <ChevronRight />
                </summary>
                <div className="row-body"><ValueEditor def={def} value={value(def)} onSet={(next) => api.setValue(def.id, playerId, next)} /></div>
              </details>
            ))}
          </div>
        </>
      )}

      <div className="sub"><p className="label">On hand</p><span className="meta">{carried.length || 'none recorded'}</span></div>
      <div className="card clip rows">
        {carried.map((thing) => (
          <button key={thing.id} type="button" className="lr" onClick={() => api.editRecord({ mode: 'edit', id: thing.id })}>
            <span className="grow"><span className="name" style={{ display: 'block' }}>{thing.name}</span>{thing.description && <span className="meta" style={{ display: 'block' }}>{thing.description}</span>}</span>
            <ChevronRight />
          </button>
        ))}
        <div className="lr">
          <p className="grow meta" style={{ color: 'var(--text-2)' }}>{carried.length ? 'Something else you carry?' : 'Nothing you carry is a record yet.'}</p>
          <button type="button" className="btn" onClick={() => api.editRecord({ mode: 'new', type: 'thing', heldBy: playerId })}>Add</button>
        </div>
      </div>
    </>
  );
}

function MomentumRow({ def, value, onSet }: { def: StateDef; value: number; onSet: (value: number) => void }) {
  const hi = Math.max(def.min, def.max);
  if (def.id === 'story-points') {
    return (
      <details>
        <summary className="row" style={{ alignItems: 'flex-start' }}>
          <span style={{ flex: 1 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="name" style={{ flex: 1 }}>{def.name}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-3)' }}>
                <span>yours</span>
                {Array.from({ length: value }, (_, index) => <span key={`y${index}`} aria-hidden="true" style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--you)' }} />)}
                <span aria-hidden="true" style={{ width: 1, height: 20, background: 'var(--line-2)' }} />
                {Array.from({ length: Math.max(0, hi - value) }, (_, index) => <span key={`r${index}`} aria-hidden="true" style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--faint)' }} />)}
                <span>the rules’</span>
              </span>
            </span>
            <span className="meta" style={{ display: 'block', marginTop: 6, lineHeight: 1.45, color: 'var(--text-2)' }}>Spend yours to upgrade a die and it crosses over. When the rules hold both, they spend one against you.</span>
          </span>
        </summary>
        <div className="row-body"><ValueEditor def={def} value={value} onSet={onSet} /></div>
      </details>
    );
  }
  return (
    <details>
      <summary className="row" style={{ minHeight: 56 }}>
        <span className="name" style={{ flex: 1 }}>{def.name}</span>
        <span className="meta">{def.id === 'edge' ? (value > 0 ? 'a boost die on your next roll' : 'none yet') : `${value} of ${hi}`}</span>
        <ChevronRight />
      </summary>
      <div className="row-body"><ValueEditor def={def} value={value} onSet={onSet} /></div>
    </details>
  );
}

function JournalSummary({ api }: { api: PlayApi }) {
  const { save, journalBusy } = api;
  const pending = save.journal.pending;
  const recent = activeEntries(save.journal).slice(-2).reverse();
  return (
    <>
      <div className="sub"><p className="label">Journal</p><button type="button" className="link" onClick={() => api.open('journal')}>Open the journal</button></div>
      <div className="card clip">
        {pending && (
          <div style={{ padding: '14px 16px', background: 'var(--surface-2)', borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="tag sugg">Suggested</span>
              <span className="meta">{pending.kind === 'entry' ? `${pending.to - pending.from} ${pending.to - pending.from === 1 ? 'turn' : 'turns'} about to leave the story window` : `combines ${pending.entryIds.length} older entries`}</span>
            </div>
            <p className="prose-strong" style={{ margin: '8px 0 12px', fontSize: 15, lineHeight: 1.55 }}>{pending.text}</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn primary" style={{ flex: 1 }} onClick={() => { const result = keepPending(save, newId('j')); if (result.ok) api.commit(result.save, 'Kept in the journal.'); else api.notify(result.reason); }}>Keep</button>
              <button type="button" className="btn" style={{ flex: 1 }} onClick={() => api.open('journal')}>Edit</button>
              <button type="button" className="btn quiet" onClick={() => { const result = discardPending(save); if (result.ok) api.commit(result.save, 'Suggestion discarded.'); }}>Discard</button>
            </div>
          </div>
        )}
        {journalBusy && !pending && <p className="writing" style={{ padding: '12px 16px', fontSize: 14 }}>Writing a journal suggestion…</p>}
        {recent.map((entry) => (
          <div key={entry.id} style={{ padding: '12px 16px 14px', borderBottom: '1px solid var(--line)' }}>
            <div className="entry-head">
              <span className="tag yours">{entry.source === 'player' ? 'Yours' : entry.source === 'compressed' ? 'Combined' : 'Kept'}</span>
            </div>
            <p className="entry-text" style={{ color: 'var(--text-2)' }}>{entry.text}</p>
          </div>
        ))}
        {!pending && !recent.length && !journalBusy && <p className="meta" style={{ padding: '14px 16px', lineHeight: 1.45 }}>Nothing yet. Write anything you want the story to remember, or wait for a suggestion as the story grows.</p>}
        <button type="button" className="lr" onClick={() => api.open('journal')}><PenIcon /><span className="name grow">Write an entry</span></button>
      </div>
    </>
  );
}
