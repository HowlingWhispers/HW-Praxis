// The journal: the story so far. Review suggestions, write anything, edit, archive, compress.
import { useEffect, useState, type RefObject } from 'react';
import {
  activeEntries, addEntry, archivedEntries, calendarOf, datePhrase, discardPending, editEntry, journalTokens, keepPending, removeEntry, setArchived, stamp,
  type JournalEntry,
} from '../engine';
import type { PlayApi } from './Play';
import { ArchiveIcon, BackIcon, CloseIcon, PenIcon } from './icons';
import { newId } from './shared';

export function JournalPanel({ api, headRef, onBack }: { api: PlayApi; headRef: RefObject<HTMLDivElement | null>; onBack: () => void }) {
  const { save, world, journalBusy, connection } = api;
  const pending = save.journal.pending;
  const [pendingText, setPendingText] = useState(pending?.text ?? '');
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  useEffect(() => { setPendingText(pending?.text ?? ''); }, [pending?.text]);

  const active = activeEntries(save.journal);
  const archived = archivedEntries(save.journal);
  const used = journalTokens(save.journal, save.options);
  const calendar = calendarOf(world);
  const apply = (result: { ok: true; save: typeof save } | { ok: false; reason: string }, message?: string) => {
    if (result.ok) api.commit(result.save, message); else api.notify(result.reason);
  };

  // Newest first, grouped under the day they belong to.
  const groups: { day: string; entries: JournalEntry[] }[] = [];
  for (const entry of [...active].reverse()) {
    const day = [stamp(calendar, entry.storyT).split(' ').slice(0, -1).join(' '), datePhrase(calendar, entry.storyT)].filter(Boolean).join(', ') || 'The story';
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.entries.push(entry);
    else groups.push({ day, entries: [entry] });
  }

  return (
    <div>
      <div className="panel-head" ref={headRef} tabIndex={-1}>
        <button type="button" className="btn quiet" onClick={onBack} style={{ paddingLeft: 4 }}><BackIcon />Menu</button>
        <h1>Journal</h1>
        <span className="spacer" />
      </div>
      <div className="panel-body">
        <div>
          <p className="meta" style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--text-2)' }}>
            The story so far. Every entry goes to the narrator with each turn, so it remembers what has left the story window.
          </p>
          <p className="mono meta" style={{ marginTop: 8, fontSize: 12 }}>
            {active.length} {active.length === 1 ? 'entry' : 'entries'} · about {used.toLocaleString('en-US')} of {save.options.journalTokens.toLocaleString('en-US')} tokens
          </p>
        </div>

        {pending ? (
          <div className="card pad" style={{ background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="tag sugg">Suggested</span>
              <span className="meta">{pending.kind === 'entry' ? `For ${pending.to - pending.from} ${pending.to - pending.from === 1 ? 'turn' : 'turns'} leaving the story window` : `Replaces ${pending.entryIds.length} older entries, which are archived`}</span>
            </div>
            <label htmlFor="pending-text" className="sr">Suggested entry</label>
            <textarea id="pending-text" className="area" rows={5} value={pendingText} onChange={(event) => setPendingText(event.target.value)} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn primary" style={{ flex: 1 }} onClick={() => apply(keepPending(save, newId('j'), pendingText), 'Kept in the journal.')}>Keep</button>
              <button type="button" className="btn quiet" onClick={() => apply(discardPending(save), 'Suggestion discarded.')}>Discard</button>
            </div>
            <p className="meta">Edit it first if you like. Kept entries stay editable.</p>
          </div>
        ) : journalBusy ? (
          <p className="writing">Writing a suggestion…</p>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn" disabled={!connection.connected} onClick={api.suggestEntry}>Suggest an entry now</button>
            <button type="button" className="btn" disabled={!connection.connected || active.length < 2} onClick={api.suggestCompression}>Compress older entries</button>
          </div>
        )}

        <div>
          <label htmlFor="journal-new" className="label field-label">New entry</label>
          <textarea id="journal-new" className="area" rows={3} placeholder="Anything the story should remember: a promise, a name, a suspicion" value={draft} onChange={(event) => setDraft(event.target.value)} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
            <button type="button" className="btn" disabled={!draft.trim()} onClick={() => { const result = addEntry(save, newId('j'), draft); apply(result, 'Added to the journal.'); if (result.ok) setDraft(''); }}>Add entry</button>
          </div>
        </div>

        {groups.map((group) => (
          <section key={group.day}>
            <p className="label" style={{ marginBottom: 8 }}>{group.day}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {group.entries.map((entry) => (
                <div key={entry.id} className="card entry">
                  <div className="grow">
                    <div className="entry-head">
                      <span className="mono meta" style={{ fontSize: 12 }}>{stamp(calendar, entry.storyT).split(' ').pop()}</span>
                      <span className="tag yours">{entry.source === 'player' ? 'Yours' : entry.source === 'compressed' ? 'Combined' : 'Kept'}</span>
                    </div>
                    {editing === entry.id ? (
                      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <label htmlFor={`edit-${entry.id}`} className="sr">Edit entry</label>
                        <textarea id={`edit-${entry.id}`} className="area" rows={4} value={editText} onChange={(event) => setEditText(event.target.value)} />
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button type="button" className="btn primary small" onClick={() => { const result = editEntry(save, entry.id, editText); apply(result); if (result.ok) setEditing(null); }}>Save</button>
                          <button type="button" className="btn quiet small" onClick={() => setEditing(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : <p className="entry-text">{entry.text}</p>}
                  </div>
                  {editing !== entry.id && (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <button type="button" className="iconbtn bare" aria-label="Edit this entry" onClick={() => { setEditing(entry.id); setEditText(entry.text); }}><PenIcon /></button>
                      <button type="button" className="iconbtn bare" aria-label="Archive this entry" onClick={() => apply(setArchived(save, entry.id, true), 'Archived. It is kept but no longer sent.')}><ArchiveIcon /></button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}

        {archived.length > 0 && (
          <details className="card clip">
            <summary className="row" style={{ minHeight: 56 }}>
              <span className="row-text"><span className="name">Archived</span><span className="meta">{archived.length} kept, never sent</span></span>
            </summary>
            <div>
              {archived.map((entry) => (
                <div key={entry.id} className="entry" style={{ borderTop: '1px solid var(--line)' }}>
                  <p className="grow entry-text" style={{ color: 'var(--text-3)', marginTop: 0 }}>{entry.text}</p>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <button type="button" className="btn quiet small" onClick={() => apply(setArchived(save, entry.id, false), 'Back in the journal.')}>Restore</button>
                    <button type="button" className="iconbtn bare" aria-label="Delete this entry for good" onClick={() => { if (window.confirm('Delete this archived entry for good?')) apply(removeEntry(save, entry.id)); }}><CloseIcon /></button>
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
