// The menu: five sections under the prompt, in the same scroll as the story, one open at a
// time, each heading saying enough to know whether to open it. Most present first: the
// scene, you, the map, the world, settings.
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { activeEntries, sceneOf, playerOf, band, read, stateDefFor, timeOfDay } from '../engine';
import type { PlayApi } from './Play';
import { ChevronDown } from './icons';
import { SceneSection } from './SceneSection';
import { YouSection } from './YouSection';
import { MapSection } from './MapSection';
import { WorldSection } from './WorldSection';
import { SettingsSection } from './SettingsSection';

export type Section = 'scene' | 'you' | 'map' | 'world' | 'settings' | 'none';

function Accordion({ anchor, title, summary, open, onToggle, children }: { anchor: string; title: string; summary: ReactNode; open: boolean; onToggle: () => void; children: ReactNode }) {
  const id = useId();
  const root = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(open);
  // Opening a section brings its heading to the top, so the section reads from its start.
  useEffect(() => {
    if (open && !wasOpen.current) root.current?.scrollIntoView({ block: 'start' });
    wasOpen.current = open;
  }, [open]);
  return (
    <section className="acc" id={anchor} ref={root}>
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

// Where each section's heading is, so other parts of the screen can bring it into view.
export const sectionAnchor = (section: Section) => `menu-${section}`;

export function Menu({ api, section, setSection, worldQuery, setWorldQuery }: {
  api: PlayApi;
  section: Section;
  setSection: (section: Section) => void;
  worldQuery: string;
  setWorldQuery: (query: string) => void;
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
    <div className="menu">
      <Accordion
        anchor={sectionAnchor('scene')}
        title="Scene"
        open={section === 'scene'}
        onToggle={toggle('scene')}
        summary={<>{scene.place.name}<span aria-hidden="true">·</span><span className="mono" style={{ fontSize: 13 }}>{timeOfDay(save.clock)}</span>{scene.timeBand}<span aria-hidden="true">·</span>{scene.present.length ? `${scene.present.length} here` : 'nobody else here'}</>}
      >
        <SceneSection api={api} />
      </Accordion>

      <Accordion
        anchor={sectionAnchor('you')}
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

      <Accordion anchor={sectionAnchor('map')} title="Map" open={section === 'map'} onToggle={toggle('map')} summary={<>{scene.exits.length} ways out{closed ? ` · ${closed} closed` : ''}</>}>
        <MapSection api={api} />
      </Accordion>

      <Accordion anchor={sectionAnchor('world')} title="World" open={section === 'world'} onToggle={toggle('world')} summary={<>{recordCount} records{save.local.length ? ` · ${save.local.length} yours` : ''} · the rules guide</>}>
        <WorldSection api={api} query={worldQuery} setQuery={setWorldQuery} />
      </Accordion>

      <Accordion anchor={sectionAnchor('settings')} title="Settings" open={section === 'settings'} onToggle={toggle('settings')} summary={<>{connection.connected ? `NovelAI connected · ${connection.model}` : 'NovelAI not connected'}{api.prefs.showDrafts ? ' · testing on' : ''}</>}>
        <SettingsSection api={api} />
      </Accordion>
    </div>
  );
}
