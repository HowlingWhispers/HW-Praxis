// The menu: one scroll of five sections, one open at a time, each heading saying enough to
// know whether to open it. Most present first: the scene, you, the map, the world, settings.
import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { activeEntries, sceneOf, playerOf, band, read, stateDefFor } from '../engine';
import type { PlayApi } from './Play';
import { BackIcon, ChevronDown } from './icons';
import { SceneSection } from './SceneSection';
import { YouSection } from './YouSection';
import { MapSection } from './MapSection';
import { WorldSection } from './WorldSection';
import { SettingsSection } from './SettingsSection';

export type Section = 'scene' | 'you' | 'map' | 'world' | 'settings' | 'none';

function Accordion({ title, summary, open, onToggle, children }: { title: string; summary: ReactNode; open: boolean; onToggle: () => void; children: ReactNode }) {
  const id = useId();
  const root = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(open);
  // Opening a section brings its heading to the top, so the section reads from its start.
  useEffect(() => {
    if (open && !wasOpen.current) root.current?.scrollIntoView({ block: 'start' });
    wasOpen.current = open;
  }, [open]);
  return (
    <section className="acc" ref={root}>
      <h2>
        <button type="button" className="acchead" aria-expanded={open} aria-controls={id} onClick={onToggle}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="accn">{title}</span>
            <span className="accs">{summary}</span>
          </span>
          <ChevronDown />
        </button>
      </h2>
      {open && <div id={id} className="accbody">{children}</div>}
    </section>
  );
}

export function Menu({ api, section, setSection, worldQuery, setWorldQuery, headRef, onClose }: {
  api: PlayApi;
  section: Section;
  setSection: (section: Section) => void;
  worldQuery: string;
  setWorldQuery: (query: string) => void;
  headRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  const { world, save, connection } = api;
  const scene = sceneOf(world, save);
  const playerId = playerOf(world);
  const toggle = (next: Section) => () => setSection(section === next ? 'none' : next);

  const condition = ['health', 'strain']
    .map((defId) => {
      const def = stateDefFor(world, defId, playerId);
      if (!def) return '';
      const reading = band(def, read(save.values, def, playerId));
      return reading.banded ? reading.label.replace(/^is /, '') : '';
    })
    .filter(Boolean)
    .join(', ');
  const pending = save.journal.pending;
  const closed = scene.exits.filter((exit) => exit.blocked).length;
  const recordCount = world.characters.length - 1 + world.world.places.length + world.world.factions.length + world.world.societies.length + world.world.species.length + world.world.memories.length + (Array.isArray(world.world.lore.importantFacts) ? world.world.lore.importantFacts.length : 0);

  return (
    <div>
      <div className="panel-head" ref={headRef} tabIndex={-1}>
        <button type="button" className="btn quiet only-narrow" onClick={onClose} style={{ paddingLeft: 4 }}><BackIcon />Story</button>
        <span className="end"><span className="mono" style={{ fontSize: 12, color: 'var(--text)' }}>{scene.stamp.split(' ').pop()}</span> · {scene.timeBand}</span>
      </div>

      <Accordion title="Scene" open={section === 'scene'} onToggle={toggle('scene')} summary={<>{scene.place.name} · {scene.present.length ? `${scene.present.length} here` : 'nobody else here'}</>}>
        <SceneSection api={api} />
      </Accordion>

      <Accordion
        title="You"
        open={section === 'you'}
        onToggle={toggle('you')}
        summary={(
          <>
            {condition || 'Condition, approaches, journal'}
            {pending && (
              <>
                <span aria-hidden="true">·</span>
                <span className="dot" style={{ background: 'var(--you)' }} />
                <span style={{ color: 'var(--text-2)' }}>journal entry to review</span>
              </>
            )}
            {!pending && activeEntries(save.journal).length > 0 && <><span aria-hidden="true">·</span><span>{activeEntries(save.journal).length} journal entries</span></>}
          </>
        )}
      >
        <YouSection api={api} />
      </Accordion>

      <Accordion title="Map" open={section === 'map'} onToggle={toggle('map')} summary={<>{scene.exits.length} ways out{closed ? ` · ${closed} closed` : ''}</>}>
        <MapSection api={api} />
      </Accordion>

      <Accordion title="World" open={section === 'world'} onToggle={toggle('world')} summary={<>{recordCount} records{save.local.length ? ` · ${save.local.length} yours` : ''} · the rules guide</>}>
        <WorldSection api={api} query={worldQuery} setQuery={setWorldQuery} />
      </Accordion>

      <Accordion title="Settings" open={section === 'settings'} onToggle={toggle('settings')} summary={<>{connection.connected ? `NovelAI connected · ${connection.model}` : 'NovelAI not connected'}{api.prefs.showDrafts ? ' · testing on' : ''}</>}>
        <SettingsSection api={api} />
      </Accordion>
    </div>
  );
}
