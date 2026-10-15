// World: look up anyone, anywhere, anything, and add records of your own.
import { useMemo, useState, type ChangeEvent } from 'react';
import { bearingOn, exportRecords, importRecords, playerOf, readRecordsFile, removeRecord, sceneOf, type PraxisModule, type Save } from '../engine';
import type { PlayApi } from './Play';
import { BookIcon, ChevronRight, DownloadIcon, PlusIcon, SearchIcon, UploadIcon } from './icons';
import { initials, isDraft } from './shared';
import { downloadJson, fileSafe, readJsonFile } from './files';

type Kind = 'person' | 'place' | 'thing' | 'group' | 'people' | 'lore';
type Filter = 'all' | Kind | 'yours';

interface Entry {
  key: string;
  kind: Kind;
  name: string;
  meta: string;
  description: string;
  details: [string, string][];
  local: boolean;
  draft: boolean;
  // Lower is nearer to the player right now.
  near: number;
  recordId?: string;
}

const KIND_ORDER: Kind[] = ['person', 'place', 'thing', 'group', 'lore', 'people'];

function entriesOf(world: PraxisModule, save: Save): Entry[] {
  const playerId = playerOf(world);
  const scene = sceneOf(world, save);
  const places = new Map(world.world.places.map((place) => [place.id, place]));
  const placeName = (id: unknown) => (typeof id === 'string' ? places.get(id)?.name ?? '' : '');
  const groups = [...world.world.factions.map((group) => ({ group, kind: 'Faction' })), ...world.world.societies.map((group) => ({ group, kind: 'Society' }))];
  const groupName = new Map(groups.map(({ group }) => [group.id, group.name]));
  const here = new Set<string>();
  for (let at: string | null = scene.place.id; at !== null && here.size < 20;) { here.add(at); at = places.get(at)?.parentLocationId ?? null; }
  const bearing = new Set(bearingOn(world, scene.place, [...scene.present, ...world.characters.filter((c) => c.id === playerId)]).groups.map((group) => group.id));
  const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
  const out: Entry[] = [];

  for (const person of world.characters) {
    if (person.id === playerId) continue;
    const species = person.speciesId ? world.world.species.find((entry) => entry.id === person.speciesId)?.name ?? '' : '';
    const role = typeof person.role === 'string' ? person.role : '';
    const now = save.positions[person.id];
    out.push({
      key: `person:${person.id}`, kind: 'person', name: person.name,
      meta: [role, placeName(person.homeLocationId) || placeName(now)].filter(Boolean).join(' · ') || species,
      description: person.description,
      details: [
        ['People', species],
        ['Belongs to', person.factionIds.map((id) => groupName.get(id) ?? id).join(', ')],
        ['Usually at', placeName(person.homeLocationId)],
        ['Now at', now === scene.place.id ? `${placeName(now)}, here with you` : placeName(now)],
      ].filter(([, value]) => value) as [string, string][],
      local: person.origin === 'local', draft: isDraft(person),
      near: now === scene.place.id ? 0 : person.origin === 'local' ? 3 : 5,
      recordId: person.origin === 'local' ? person.id : undefined,
    });
  }

  for (const place of world.world.places) {
    const inside = world.world.places.filter((child) => child.parentLocationId === place.id).map((child) => child.name);
    const people = world.characters.filter((person) => person.id !== playerId && save.positions[person.id] === place.id).map((person) => person.name);
    out.push({
      key: `place:${place.id}`, kind: 'place', name: place.name,
      meta: [place.kind !== 'other' ? capitalise(place.kind) : 'Place', placeName(place.parentLocationId)].filter(Boolean).join(' · '),
      description: place.description,
      details: [['Inside', placeName(place.parentLocationId)], ['Places in it', inside.join(', ')], ['People there now', people.join(', ')]].filter(([, value]) => value) as [string, string][],
      local: place.origin === 'local', draft: isDraft(place),
      near: place.id === scene.place.id ? 0 : here.has(place.id) ? 1 : place.origin === 'local' ? 3 : 5,
      recordId: place.origin === 'local' ? place.id : undefined,
    });
  }

  for (const { group, kind } of groups) {
    const members = world.characters.filter((person) => person.factionIds.includes(group.id)).map((person) => person.name);
    out.push({
      key: `group:${group.id}`, kind: 'group', name: group.name,
      meta: [kind, list(group.settlementLocationIds).concat(list(group.territoryLocationIds)).map(placeName).filter(Boolean)[0] ?? ''].filter(Boolean).join(' · '),
      description: group.description,
      details: [
        ['Members', members.join(', ')],
        ['Settlements', list(group.settlementLocationIds).map(placeName).filter(Boolean).join(', ')],
        ['Territory', list(group.territoryLocationIds).map(placeName).filter(Boolean).join(', ')],
        ['Includes', list(group.factionIds).map((id) => groupName.get(id) ?? '').filter(Boolean).join(', ')],
      ].filter(([, value]) => value) as [string, string][],
      local: group.origin === 'local', draft: isDraft(group),
      near: bearing.has(group.id) ? 2 : group.origin === 'local' ? 3 : 5,
      recordId: group.origin === 'local' ? group.id : undefined,
    });
  }

  for (const species of world.world.species) {
    out.push({ key: `people:${species.id}`, kind: 'people', name: species.name, meta: 'People', description: species.description, details: [], local: false, draft: isDraft(species), near: 6 });
  }

  const facts = Array.isArray(world.world.lore.importantFacts) ? world.world.lore.importantFacts.filter((fact): fact is string => typeof fact === 'string') : [];
  facts.forEach((fact, index) => {
    const name = fact.split(/[.;:]/)[0]!.split(/\s+/).slice(0, 7).join(' ');
    out.push({ key: `fact:${index}`, kind: 'lore', name: name.length < fact.length ? `${name}…` : name, meta: 'Established fact', description: fact, details: [], local: false, draft: false, near: 5 });
  });
  for (const memory of world.world.memories) {
    out.push({
      key: `memory:${memory.id}`, kind: 'lore', name: memory.title,
      meta: memory.origin === 'local' ? 'Note' : [capitalise(typeof memory.kind === 'string' ? memory.kind : 'memory'), list(memory.locationIds).map(placeName).filter(Boolean)[0] ?? ''].filter(Boolean).join(' · '),
      description: memory.description, details: [], local: memory.origin === 'local', draft: isDraft(memory),
      near: list(memory.locationIds).some((id) => here.has(id)) ? 2 : memory.origin === 'local' ? 3 : 5,
      recordId: memory.origin === 'local' ? memory.id : undefined,
    });
  }
  for (const thing of world.items) {
    out.push({
      key: `thing:${thing.id}`, kind: 'thing', name: thing.name, meta: ['Thing', placeName(thing.locationId) || (thing.heldBy === playerId ? 'carried by you' : '')].filter(Boolean).join(' · '),
      description: thing.description, details: [], local: thing.origin === 'local', draft: isDraft(thing),
      near: thing.locationId === scene.place.id || thing.heldBy === playerId ? 1 : 3, recordId: thing.origin === 'local' ? thing.id : undefined,
    });
  }
  return out;
}

export function WorldSection({ api, query, setQuery }: { api: PlayApi; query: string; setQuery: (query: string) => void }) {
  const { world, save, prefs } = api;
  const [filter, setFilter] = useState<Filter>('all');
  const [showAll, setShowAll] = useState(false);
  const entries = useMemo(() => entriesOf(world, save), [world, save]);
  const counts = useMemo(() => {
    const result: Record<Filter, number> = { all: entries.length, person: 0, place: 0, thing: 0, group: 0, people: 0, lore: 0, yours: 0 };
    for (const entry of entries) {
      result[entry.kind] += 1;
      if (entry.local) result.yours += 1;
    }
    return result;
  }, [entries]);

  const needle = query.trim().toLowerCase();
  const shown = entries
    .filter((entry) => filter === 'all' || (filter === 'yours' ? entry.local : entry.kind === filter))
    .filter((entry) => !needle || `${entry.name} ${entry.meta} ${entry.description}`.toLowerCase().includes(needle))
    .sort((a, b) => a.near - b.near || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name));
  const visible = showAll || needle ? shown : shown.slice(0, 12);

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const read = await readJsonFile(file);
    if (!read.ok) { api.notify(read.error); return; }
    const parsed = readRecordsFile(read.data);
    if (!parsed.ok) { api.notify(parsed.errors.join(' ')); return; }
    const result = importRecords(api.module, save, parsed.file.records);
    api.commit(result.save, `${result.added} ${result.added === 1 ? 'record' : 'records'} added.${result.skipped.length ? ` Skipped: ${result.skipped.join('; ')}` : ''}`);
  }

  const filters: [Filter, string][] = [['all', 'All'], ['person', 'People'], ['place', 'Places'], ['thing', 'Things'], ['group', 'Groups'], ['lore', 'Lore'], ['people', 'Peoples'], ['yours', 'Yours']];

  return (
    <>
      <button type="button" className="card lr" style={{ borderTop: '1px solid var(--line)', marginBottom: 14 }} onClick={() => api.open('guide')}>
        <BookIcon />
        <span className="grow">
          <span className="name" style={{ display: 'block' }}>How Praxis plays</span>
          <span className="meta" style={{ display: 'block', marginTop: 2 }}>Turns, approaches, checks and dice, condition, the journal</span>
        </span>
        <ChevronRight />
      </button>

      <div className="search-box">
        <SearchIcon />
        <label htmlFor="world-search" className="sr">Search the world</label>
        <input id="world-search" type="search" className="field search" placeholder="Search people, places, groups, lore" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div role="group" aria-label="Show" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
        {filters.filter(([key]) => key === 'all' || counts[key] > 0).map(([key, label]) => (
          <button key={key} type="button" className={`fchip${key === 'yours' ? ' yours' : ''}`} aria-pressed={filter === key} onClick={() => setFilter(key)}>
            {label} <span className="n">{counts[key]}</span>
          </button>
        ))}
      </div>

      <div className="sub"><p className="label">{needle ? `${shown.length} found` : 'Nearest you first'}</p></div>
      <div className="card clip rows">
        {visible.length === 0 && <p className="meta" style={{ padding: '14px 16px' }}>Nothing matches. Add it as a record if the story needs it.</p>}
        {visible.map((entry) => (
          <details key={entry.key}>
            <summary className="row">
              <span className={`av${entry.kind === 'group' ? ' group' : entry.kind === 'place' || entry.kind === 'lore' || entry.kind === 'thing' ? ' place' : ''}${entry.local ? ' yours' : ''}`} aria-hidden="true">{initials(entry.name)}</span>
              <span className="row-text">
                <span className="name">{entry.name}</span>
                {entry.meta && <span className="meta">{entry.meta}</span>}
              </span>
              {entry.local && <span className="tag yours">Yours</span>}
              {prefs.showDrafts && entry.draft && <span className="tag draft">Draft</span>}
              <ChevronRight />
            </summary>
            <div className="row-body">
              {entry.description ? <p className="prose">{entry.description}</p> : <p className="meta">No description.</p>}
              {entry.details.length > 0 && (
                <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', fontSize: 14 }}>
                  {entry.details.map(([label, value]) => (
                    <div key={label} style={{ display: 'contents' }}>
                      <dt className="label" style={{ paddingTop: 3 }}>{label}</dt>
                      <dd style={{ margin: 0, color: 'var(--text-2)' }}>{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {entry.recordId && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn" onClick={() => api.editRecord({ mode: 'edit', id: entry.recordId! })}>Edit</button>
                  <button
                    type="button"
                    className="btn quiet danger"
                    onClick={() => {
                      if (!window.confirm(`Remove ${entry.name} from this save?`)) return;
                      const result = removeRecord(api.module, save, entry.recordId!);
                      if (result.ok) api.commit(result.save, `${entry.name} removed.`); else api.notify(result.reason);
                    }}
                  >Remove</button>
                </div>
              )}
            </div>
          </details>
        ))}
      </div>
      {!needle && !showAll && shown.length > visible.length && (
        <button type="button" className="btn quiet wide" style={{ marginTop: 10 }} onClick={() => setShowAll(true)}>Show all {shown.length}</button>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 18 }}>
        <button type="button" className="btn primary wide" onClick={() => api.editRecord({ mode: 'new' })}><PlusIcon />Add a local record</button>
        <div className="two">
          <button type="button" className="btn" disabled={!save.local.length} onClick={() => downloadJson(`${fileSafe(api.name)}.records.json`, exportRecords(api.module, save))}><DownloadIcon />Export yours</button>
          <label className="btn" style={{ cursor: 'pointer' }}>
            <UploadIcon />Import
            <input type="file" accept="application/json,.json" className="sr" onChange={(event) => void importFile(event)} />
          </label>
        </div>
        <p className="hint">Records you add live in this save. The module stays as it was published.</p>
      </div>
    </>
  );
}

function capitalise(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}
