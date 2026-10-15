// Scene: where you are, the time, who and what is here, and what you can do.
import { useState } from 'react';
import {
  band, calendarOf, datePhrase, durationWords, line, read, sceneActionsFor, sceneOf, stateDefFor, timeOfDay, weekdayOf,
  type Character,
} from '../engine';
import type { PlayApi } from './Play';
import { ChevronRight, LockIcon } from './icons';
import { DraftTag, StateBar, YoursTag, characterStates, groupsOf, initials, roleOf, speciesOf, stateColor } from './shared';
import { ValueEditor } from './ValueEditor';

export function SceneSection({ api }: { api: PlayApi }) {
  const { world, save, prefs, busy } = api;
  const scene = sceneOf(world, save);
  const calendar = calendarOf(world);
  const weekday = weekdayOf(calendar, save.clock);
  const date = [weekday >= 0 ? calendar.dayNames[weekday] : '', datePhrase(calendar, save.clock)].filter(Boolean).join(' ');
  const parent = scene.place.parentLocationId ? world.world.places.find((place) => place.id === scene.place.parentLocationId) : undefined;
  const placeStates = world.ruleset.states.filter((def) => def.scope === 'place' && def.display !== 'hidden');
  const actions = sceneActionsFor(world, save);
  const [waitOther, setWaitOther] = useState('');

  return (
    <>
      <div className="card pad">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <p className="label" style={{ flex: 1 }}>{[scene.place.kind !== 'other' ? scene.place.kind : '', parent?.name].filter(Boolean).join(' · ')}</p>
          <DraftTag record={scene.place} show={prefs.showDrafts} />
          <YoursTag record={scene.place} />
        </div>
        <h3 style={{ margin: '8px 0 6px', font: '600 26px/1.15 var(--read)' }}>{scene.place.name}</h3>
        {scene.place.description && <p className="prose" style={{ fontSize: 16 }}>{scene.place.description}</p>}
        <div className="facts-grid">
          <div className="fact">
            <p className="label">Time</p>
            <p className="big">{timeOfDay(save.clock)}</p>
            <p className="meta">{capitalise(scene.timeBand)}{date ? `, ${date}` : ''}</p>
          </div>
          {placeStates.map((def) => {
            const value = read(save.values, def, scene.place.id);
            const reading = band(def, value);
            return (
              <div key={def.id} className="fact">
                <p className="label">{def.name}</p>
                <p className="big word">{reading.banded ? reading.label : value}</p>
                {prefs.showNumbers && <p className="meta">{value} of {Math.max(def.min, def.max)}</p>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="sub"><p className="label">People here</p><span className="meta">{scene.present.length || 'none'}</span></div>
      {scene.present.length ? (
        <div className="card clip rows">
          {scene.present.map((person, index) => <PersonRow key={person.id} api={api} person={person} open={index === 0 && scene.present.length === 1} />)}
        </div>
      ) : (
        <div className="card pad"><p className="meta">Nobody else is here.</p></div>
      )}

      <div className="sub"><p className="label">Things here</p><span className="meta">{scene.things.length || 'none recorded'}</span></div>
      <div className="card clip rows">
        {scene.things.map((thing) => (
          <details key={thing.id}>
            <summary className="row">
              <span className="av place" aria-hidden="true">{initials(thing.name)}</span>
              <span className="row-text"><span className="name">{thing.name}</span>{typeof thing.summary === 'string' && thing.summary && <span className="meta">{thing.summary}</span>}</span>
              <YoursTag record={thing} />
              <ChevronRight />
            </summary>
            <div className="row-body">
              {thing.description && <p className="prose">{thing.description}</p>}
              <button type="button" className="btn" onClick={() => api.editRecord({ mode: 'edit', id: thing.id })}>Edit</button>
            </div>
          </details>
        ))}
        <div className="lr" style={{ paddingTop: 14, paddingBottom: 14 }}>
          <p className="grow meta" style={{ lineHeight: 1.45, color: 'var(--text-2)' }}>
            {scene.things.length ? 'Add anything else the story brings in.' : 'Things the story mentions are only description until you add them. Add one and it stays with your story.'}
          </p>
          <button type="button" className="btn" onClick={() => api.editRecord({ mode: 'new', type: 'thing', locationId: scene.place.id })}>Add</button>
        </div>
      </div>

      <div className="sub"><p className="label">What you can do</p></div>
      <div className="card">
        {actions.map((action) => (
          <div key={action.id} className="lr">
            <span className="grow">
              <span className="name" style={{ display: 'block' }}>{action.name}</span>
              {action.summary && <span className="meta" style={{ display: 'block', marginTop: 2 }}>{action.summary}</span>}
            </span>
            <button type="button" className="btn primary" disabled={busy} onClick={() => api.perform({ type: 'scene', actionId: action.id })}>Do it</button>
          </div>
        ))}
        <div className="lr stack">
          <span className="name">Wait</span>
          <div className="seg" role="group" aria-label="Wait for">
            {([[10, '10 min'], [60, '1 hour'], [240, '4 hours']] as const).map(([minutes, label]) => (
              <button key={minutes} type="button" disabled={busy} onClick={() => api.perform({ type: 'wait', minutes })}>{label}</button>
            ))}
          </div>
          <form
            style={{ display: 'flex', gap: 8 }}
            onSubmit={(event) => {
              event.preventDefault();
              const minutes = Math.round(Number(waitOther));
              if (minutes > 0) { api.perform({ type: 'wait', minutes }); setWaitOther(''); }
            }}
          >
            <label htmlFor="wait-other" className="sr">Minutes to wait</label>
            <input id="wait-other" className="field" inputMode="numeric" placeholder="Or a number of minutes" value={waitOther} onChange={(event) => setWaitOther(event.target.value.replace(/[^\d]/g, ''))} />
            <button type="submit" className="btn" disabled={busy || !waitOther}>Wait</button>
          </form>
        </div>
      </div>

      <div className="sub"><p className="label">Ways out</p><button type="button" className="link" onClick={() => api.open('menu', 'map')}>Open the map</button></div>
      <div className="card">
        {scene.exits.length === 0 && <div className="lr"><span className="meta">No known way out.</span></div>}
        {scene.exits.map((exit) => (
          <div key={`${exit.edge.kind}:${exit.edge.routeId ?? exit.place.id}`} className="lr" style={exit.blocked ? { alignItems: 'flex-start' } : undefined}>
            {exit.blocked && <span style={{ color: 'var(--bad)', marginTop: 2 }}><LockIcon size={18} /></span>}
            <span className="grow">
              <span className="name" style={{ display: 'block' }}>{exit.place.name}</span>
              {exit.blocked && <span style={{ display: 'block', marginTop: 3, fontSize: 14, lineHeight: 1.4, color: 'var(--text-2)' }}>{exit.blocked}</span>}
            </span>
            <span className="mono meta">{durationWords(exit.edge.minutes)}</span>
            {!exit.blocked && <button type="button" className="btn" disabled={busy} onClick={() => api.perform({ type: 'travel', to: exit.place.id })}>Go</button>}
          </div>
        ))}
      </div>
    </>
  );
}

function capitalise(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function PersonRow({ api, person, open }: { api: PlayApi; person: Character; open: boolean }) {
  const { world, save, prefs } = api;
  const defs = characterStates(world, person, false);
  const offRest = defs
    .map((def) => ({ def, value: read(save.values, def, person.id) }))
    .map((entry) => ({ ...entry, reading: band(entry.def, entry.value) }))
    .filter((entry) => entry.reading.banded && !entry.reading.atRest);
  const knows = defs.map((def) => line(stateDefFor(world, def.id, person.id) ?? def, person.name, read(save.values, def, person.id))).filter(Boolean);
  const meta = [roleOf(person), speciesOf(world, person), ...groupsOf(world, person)].filter(Boolean).join(' · ');
  const local = person.origin === 'local';

  return (
    <details open={open}>
      <summary className="row">
        <span className={`av${local ? ' yours' : ''}`} aria-hidden="true">{initials(person.name)}</span>
        <span className="row-text">
          <span className="name">{person.name}</span>
          {meta && <span className="meta">{meta}</span>}
        </span>
        {offRest.slice(0, 2).map(({ def, reading }) => (
          <span key={def.id} className="pill"><span className="dot" style={{ background: stateColor(def) }} />{reading.label.replace(/^is /, '')}</span>
        ))}
        <DraftTag record={person} show={prefs.showDrafts} />
        <ChevronRight />
      </summary>
      <div className="row-body">
        {person.description && <p className="prose">{person.description}</p>}
        {defs.filter((def) => def.bands.length).length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {defs.filter((def) => def.bands.length).map((def) => {
              const value = read(save.values, def, person.id);
              return (
                <div key={def.id} className="state-line">
                  <span className="what">{def.name}</span>
                  <StateBar def={def} value={value} />
                  <span className="word">{band(def, value).label}{prefs.showNumbers ? ` · ${value}` : ''}</span>
                </div>
              );
            })}
          </div>
        )}
        <div className="knows">
          <p className="label">The narrator knows</p>
          <p className="facts">{knows.length ? knows.join(' ') : 'Only their description: nothing about them is out of the ordinary.'}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn" style={{ flex: 1 }} onClick={() => api.talkTo(person.name)}>Talk to them</button>
          <button type="button" className="btn quiet" onClick={() => api.lookUp(person.name)}>Look up</button>
          {local && <button type="button" className="btn quiet" onClick={() => api.editRecord({ mode: 'edit', id: person.id })}>Edit</button>}
        </div>
        {defs.length > 0 && (
          <details>
            <summary className="meta" style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>Set their values by hand</summary>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {defs.map((def) => <ValueEditor key={def.id} def={def} value={read(save.values, def, person.id)} onSet={(value) => api.setValue(def.id, person.id, value)} />)}
            </div>
          </details>
        )}
      </div>
    </details>
  );
}
