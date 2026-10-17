// Adding or editing one of the player's own records.
import { useState, type RefObject } from 'react';
import {
  AREA_KINDS, PLACE_KINDS, addRecord, isArea, midSentence, placeCharacter, playerOf, removeRecord, sceneOf, updateRecord,
  type LocalRecordInput, type RecordType, type Save,
} from '../engine';
import type { PlayApi } from './Play';
import { BackIcon } from './icons';
import { newId } from './shared';

export type RecordTarget =
  | { mode: 'new'; type?: RecordType; locationId?: string; heldBy?: string }
  | { mode: 'edit'; id: string };

const TYPES: [RecordType, string][] = [['person', 'Person'], ['place', 'Place'], ['thing', 'Thing'], ['group', 'Group'], ['note', 'Note']];
const LOCAL_PLACE_KINDS = PLACE_KINDS.filter((kind) => !AREA_KINDS.includes(kind));

const READS: Record<RecordType, string> = {
  person: 'The narrator reads this whenever they are in the scene, and their name is always in the world notes.',
  place: 'The narrator reads this when you are there. It joins the map and can be travelled to.',
  thing: 'The narrator reads this when it is where you are, or when you carry it.',
  group: 'Named in the world notes, and read in full when one of its people is in the scene.',
  note: 'Sent with every turn, in the world notes.',
  bond: 'The narrator reads it whenever both of them are in the scene.',
};

export function RecordPanel({ api, target, headRef, onDone }: { api: PlayApi; target: RecordTarget; headRef: RefObject<HTMLDivElement>; onDone: () => void }) {
  const { module, world, save } = api;
  const scene = sceneOf(world, save);
  const playerId = playerOf(world);
  const existing = target.mode === 'edit' ? save.local.find((record) => record.id === target.id) : undefined;
  const places = world.world.places.filter((place) => !isArea(place) && place.id !== existing?.id).sort((a, b) => a.name.localeCompare(b.name));
  const groups = [...world.world.factions, ...world.world.societies].filter((group) => group.id !== existing?.id);

  const [type, setType] = useState<RecordType>(existing?.type ?? (target.mode === 'new' ? target.type : undefined) ?? 'person');
  const [name, setName] = useState(existing?.name ?? '');
  const [summary, setSummary] = useState(existing?.summary ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [playerNote, setPlayerNote] = useState(existing?.playerNote ?? '');
  const [speciesId, setSpeciesId] = useState(existing?.speciesId ?? '');
  const [pronouns, setPronouns] = useState(existing?.pronouns ?? '');
  const [groupId, setGroupId] = useState(existing?.factionIds[0] ?? '');
  const [kind, setKind] = useState<string>(existing?.kind ?? 'building');
  const [parentId, setParentId] = useState(existing?.parentLocationId ?? scene.place.id);
  const [whereId, setWhereId] = useState(existing ? save.positions[existing.id] ?? '' : scene.place.id);
  const [thingAt, setThingAt] = useState(
    existing ? (existing.heldBy === playerId ? 'carried' : existing.locationId ?? '')
      : target.mode === 'new' && target.heldBy ? 'carried'
      : target.mode === 'new' && target.locationId ? target.locationId : scene.place.id,
  );
  const [problem, setProblem] = useState('');

  function input(): LocalRecordInput {
    const base: LocalRecordInput = { id: existing?.id ?? newId(`local-${type}`), type, name: name.trim(), summary: summary.trim(), description: description.trim(), playerNote: playerNote.trim(), factionIds: [] };
    if (type === 'person') return { ...base, speciesId: speciesId || undefined, pronouns: pronouns || undefined, factionIds: groupId ? [groupId] : [] };
    if (type === 'place') return { ...base, kind: kind as LocalRecordInput['kind'], parentLocationId: parentId || undefined };
    if (type === 'thing') return { ...base, heldBy: thingAt === 'carried' ? playerId : undefined, locationId: thingAt && thingAt !== 'carried' ? thingAt : undefined };
    return base;
  }

  function save_() {
    if (!name.trim()) { setProblem('Give it a name.'); return; }
    const record = input();
    let next: Save;
    if (existing) {
      const updated = updateRecord(module, save, existing.id, { ...record, speciesId: record.speciesId, pronouns: record.pronouns, kind: record.kind, parentLocationId: record.parentLocationId, heldBy: record.heldBy, locationId: record.locationId });
      if (!updated.ok) { setProblem(updated.reason); return; }
      next = updated.save;
      if (type === 'person' && (save.positions[existing.id] ?? '') !== whereId) {
        const moved = placeCharacter(module, next, existing.id, whereId || null);
        if (!moved.ok) { setProblem(moved.reason); return; }
        next = moved.save;
      }
    } else {
      const added = addRecord(module, save, record, type === 'person' && whereId ? whereId : null);
      if (!added.ok) { setProblem(added.reason); return; }
      next = added.save;
    }
    api.commit(next, existing ? `${record.name} updated.` : `${record.name} added to your records.`);
    onDone();
  }

  function remove() {
    if (!existing || !window.confirm(`Remove ${existing.name} from this save?`)) return;
    const result = removeRecord(module, save, existing.id);
    if (!result.ok) { setProblem(result.reason); return; }
    api.commit(result.save, `${existing.name} removed.`);
    onDone();
  }

  const species = speciesId ? world.world.species.find((entry) => entry.id === speciesId)?.name : '';
  const preview = type === 'person'
    ? [[name.trim() || 'Unnamed', midSentence(summary.trim()), species].filter(Boolean).join(', '), description.trim()].filter(Boolean).join(': ')
    : [name.trim() || 'Unnamed', description.trim() || summary.trim()].filter(Boolean).join(': ');

  return (
    <div>
      <div className="panel-head" ref={headRef} tabIndex={-1}>
        <button type="button" className="btn quiet" onClick={onDone} style={{ paddingLeft: 4 }}><BackIcon />Cancel</button>
        <h1>{existing ? 'Edit record' : 'New record'}</h1>
        <span className="spacer" style={{ display: 'flex', justifyContent: 'flex-end' }}><span className="tag yours">Yours</span></span>
      </div>
      <form className="panel-body" onSubmit={(event) => { event.preventDefault(); save_(); }}>
        {!existing && <p className="meta" style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--text-2)' }}>Someone or something the story brought in. It lives in this save, and the narrator reads it like the module’s own records.</p>}

        {!existing && (
          <div>
            <span id="record-type" className="label field-label">Kind</span>
            <div className="seg" role="group" aria-labelledby="record-type">
              {TYPES.map(([value, label]) => <button key={value} type="button" aria-pressed={type === value} onClick={() => setType(value)}>{label}</button>)}
            </div>
          </div>
        )}

        <div>
          <label htmlFor="record-name" className="label field-label">Name</label>
          <input id="record-name" className="field" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
        </div>
        <div>
          <label htmlFor="record-summary" className="label field-label">In a few words</label>
          <input id="record-summary" className="field" value={summary} maxLength={300} placeholder={type === 'person' ? 'A gate runner' : type === 'place' ? 'A tavern by the slips' : ''} onChange={(event) => setSummary(event.target.value)} />
        </div>
        <div>
          <label htmlFor="record-description" className="label field-label">Description</label>
          <textarea id="record-description" className="area" rows={4} value={description} maxLength={8000} onChange={(event) => setDescription(event.target.value)} />
          <p className="hint">{READS[type]}</p>
        </div>

        {type === 'person' && (
          <>
            <div className="two">
              <div>
                <label htmlFor="record-species" className="label field-label">People</label>
                <select id="record-species" className="select" value={speciesId} onChange={(event) => setSpeciesId(event.target.value)}>
                  <option value="">Not stated</option>
                  {world.world.species.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="record-group" className="label field-label">Belongs to</label>
                <select id="record-group" className="select" value={groupId} onChange={(event) => setGroupId(event.target.value)}>
                  <option value="">No group</option>
                  {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="record-pronouns" className="label field-label">Pronouns</label>
              <select id="record-pronouns" className="select" value={pronouns} onChange={(event) => setPronouns(event.target.value)}>
                <option value="">They/them</option>
                <option value="she/her">She/her</option>
                <option value="he/him">He/him</option>
                <option value="it/its">It/its</option>
              </select>
            </div>
            <div>
              <label htmlFor="record-where" className="label field-label">Where they are</label>
              <select id="record-where" className="select" value={whereId} onChange={(event) => setWhereId(event.target.value)}>
                <option value="">Nowhere in the story yet</option>
                {places.map((place) => <option key={place.id} value={place.id}>{place.id === scene.place.id ? `${place.name} (here)` : place.name}</option>)}
              </select>
            </div>
          </>
        )}

        {type === 'place' && (
          <div className="two">
            <div>
              <label htmlFor="record-kind" className="label field-label">What it is</label>
              <select id="record-kind" className="select" value={kind} onChange={(event) => setKind(event.target.value)}>
                {LOCAL_PLACE_KINDS.map((option) => <option key={option} value={option}>{option.charAt(0).toUpperCase() + option.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="record-parent" className="label field-label">Inside</label>
              <select id="record-parent" className="select" value={parentId} onChange={(event) => setParentId(event.target.value)}>
                {places.map((place) => <option key={place.id} value={place.id}>{place.id === scene.place.id ? `${place.name} (here)` : place.name}</option>)}
              </select>
            </div>
          </div>
        )}

        {type === 'thing' && (
          <div>
            <label htmlFor="record-at" className="label field-label">Where it is</label>
            <select id="record-at" className="select" value={thingAt} onChange={(event) => setThingAt(event.target.value)}>
              <option value="carried">Carried by you</option>
              {places.map((place) => <option key={place.id} value={place.id}>{place.id === scene.place.id ? `${place.name} (here)` : place.name}</option>)}
              <option value="">Nowhere in particular</option>
            </select>
          </div>
        )}

        <div>
          <label htmlFor="record-note" className="label field-label">Private note</label>
          <textarea id="record-note" className="area" rows={2} value={playerNote} maxLength={4000} onChange={(event) => setPlayerNote(event.target.value)} />
          <p className="hint">For you only. Never sent to the narrator.</p>
        </div>

        <div className="preview">
          <span className="label">The narrator will read</span>
          <p>{preview}</p>
        </div>

        {problem && <p className="notice warn" role="alert">{problem}</p>}
        <button type="submit" className="btn primary wide" style={{ minHeight: 52 }}>{existing ? 'Save changes' : 'Save record'}</button>
        {existing && <button type="button" className="btn quiet wide danger" onClick={remove}>Remove this record</button>}
        <p className="hint" style={{ textAlign: 'center' }}>Exported with the save, or on its own from World › Export yours.</p>
      </form>
    </div>
  );
}
