// Playing a save. One scroll, top to bottom: the story, the prompt at its end, and the menu
// below the prompt. A check opens in the prompt's place; the journal, the rules guide and
// the record form open in the menu's. Every change goes through the engine: this file
// decides what to show and when to ask NovelAI.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  act, cleanReply, cleanSuggestion, compressRequest, compressionDue, contextPlan, durationWords, entryRequest, inSentence,
  journalDue, lastTurn, placeCharacter, playable, playerOf, promptChars, recordPromptSize, say, sceneActionsFor, sceneOf,
  setPending, setReply, setState, targetsHere, timeOfDay, uncoveredTurns, undoLastTurn,
  type Action, type ContextPlan, type PraxisModule, type Save, type Turn,
} from '../engine';
import type { Connection } from './Connect';
import { RichText } from './RichText';
import { Menu, sectionAnchor, type Section } from './Menu';
import { JournalPanel } from './JournalPanel';
import { GuidePanel } from './GuidePanel';
import { RecordPanel, type RecordTarget } from './RecordPanel';
import { CheckPanel } from './CheckPanel';
import { CheckCard } from './CheckCard';
import { DiamondIcon, RerollIcon, SendIcon, StopIcon, UndoIcon } from './icons';
import { SourceTag, describeEntry, newId } from './shared';
import { NarrationError, narrate, promptTokensOf, type Diagnostics } from './novelai';
import type { Prefs } from './prefs';

// Where the player can be taken: the prompt, or the menu space and what it is showing.
export type View = 'story' | 'menu' | 'journal' | 'guide' | 'record';
type Page = 'menu' | 'journal' | 'guide' | 'record';

export interface Call {
  at: string;
  purpose: 'narration' | 'journal';
  ok: boolean;
  ms: number;
  message: string;
  diagnostics: Diagnostics | null;
}

// What the menu and its screens may do. One object, so every screen acts the same way.
export interface PlayApi {
  module: PraxisModule;
  world: PraxisModule;
  save: Save;
  name: string;
  prefs: Prefs;
  setPrefs: (changes: Partial<Prefs>) => void;
  connection: Connection;
  setConnection: (next: Connection) => void;
  busy: boolean;
  journalBusy: boolean;
  calls: Call[];
  lastPlan: ContextPlan | null;
  // Replaces the save, with an optional message for the player.
  commit: (next: Save, message?: string) => void;
  notify: (message: string) => void;
  perform: (action: Action) => void;
  setValue: (defId: string, owner: string, value: number) => void;
  putSelf: (placeId: string) => void;
  talkTo: (name: string) => void;
  lookUp: (query: string) => void;
  open: (view: View, section?: Section) => void;
  editRecord: (target: RecordTarget) => void;
  // Opens the check screen, aimed at someone or something here if given.
  openCheck: (owner?: string) => void;
  // The player's unsent words, which a check can use as its line.
  draft: string;
  clearDraft: () => void;
  suggestEntry: () => void;
  suggestCompression: () => void;
  leave: () => void;
}

export function Play({ module, initial, name, connection, setConnection, prefs, setPrefs, onChange, onClose }: {
  module: PraxisModule;
  initial: Save;
  name: string;
  connection: Connection;
  setConnection: (next: Connection) => void;
  prefs: Prefs;
  setPrefs: (changes: Partial<Prefs>) => void;
  onChange: (save: Save) => void;
  onClose: () => void;
}) {
  const [save, setSave] = useState<Save>(initial);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [journalBusy, setJournalBusy] = useState(false);
  const [lastPlan, setLastPlan] = useState<ContextPlan | null>(null);
  const [calls, setCalls] = useState<Call[]>([]);
  const [page, setPage] = useState<Page>('menu');
  const [section, setSection] = useState<Section>('none');
  const [worldQuery, setWorldQuery] = useState('');
  const [recordTarget, setRecordTarget] = useState<RecordTarget>({ mode: 'new' });
  // The check form, which takes the prompt's place while it is open.
  const [check, setCheck] = useState<{ owner?: string; fromMenu: boolean } | null>(null);
  const pending = useRef<AbortController | null>(null);
  const suggesting = useRef(false);
  // The turn count when a suggestion last failed, so a failure is not retried every render.
  const failedAt = useRef(-1);
  const composer = useRef<HTMLTextAreaElement | null>(null);
  const pageHead = useRef<HTMLDivElement>(null);
  const checkHead = useRef<HTMLDivElement>(null);

  const world = playable(module, save.local);
  const playerId = playerOf(world);
  const scene = sceneOf(world, save);
  const latest = lastTurn(save);

  useEffect(() => { onChange(save); }, [save, onChange]);
  useEffect(() => () => pending.current?.abort(), []);
  // A new turn, an undo, or opening the save: show the end of the story with the prompt.
  useEffect(() => { showLatest(); }, [save.turns.length]);
  // A reply landing or the narrator starting: the same, unless the player has gone down
  // into the menu to read something while they wait.
  useEffect(() => { if (!readingMenu()) showLatest(); }, [latest?.reply, busy]);
  useEffect(() => {
    if (page === 'menu') return;
    pageHead.current?.focus({ preventScroll: true });
    bringToTop('menu-space');
  }, [page]);
  useEffect(() => {
    if (!check) return;
    checkHead.current?.focus({ preventScroll: true });
    bringToTop('prompt');
  }, [check]);

  const logCall = useCallback((call: Call) => setCalls((list) => [call, ...list].slice(0, 10)), []);

  async function runNarration(target: Save) {
    const turn = lastTurn(target);
    if (!turn) return;
    if (!connection.connected) { setNotice('Recorded. Connect NovelAI in Settings to have it narrated.'); return; }
    let plan: ContextPlan;
    try {
      plan = contextPlan(module, target);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The narrator\'s notes could not be built.');
      return;
    }
    setLastPlan(plan);
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setNotice('');
    const started = performance.now();
    try {
      const result = await narrate(plan.messages, connection.model, connection.mode, { maxTokens: target.options.replyTokens, signal: controller.signal });
      if (controller.signal.aborted) return;
      const ms = Math.round(performance.now() - started);
      const promptTokens = promptTokensOf(result.usage);
      logCall({ at: new Date().toLocaleTimeString(), purpose: 'narration', ok: true, ms, message: `${result.text.length} characters${promptTokens ? `, prompt ${promptTokens} tokens` : ''}`, diagnostics: result.diagnostics ?? null });
      setSave((current) => {
        const placed = setReply(current, turn.id, cleanReply(result.text, turn.input));
        if (!placed.ok) return current;
        return promptTokens ? recordPromptSize(placed.save, promptChars(plan.messages), promptTokens) : placed.save;
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : 'Narration failed.';
      setNotice(`${message} Settings › Testing › Diagnostics has the details.`);
      logCall({ at: new Date().toLocaleTimeString(), purpose: 'narration', ok: false, ms: 0, message, diagnostics: error instanceof NarrationError ? error.diagnostics : null });
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }

  // Journal suggestions run in the background and land as a pending suggestion.
  async function suggest(target: Save, request: { kind: 'entry'; from: number; to: number } | { kind: 'compress'; entryIds: string[] }) {
    if (suggesting.current || !connection.connected) return;
    suggesting.current = true;
    setJournalBusy(true);
    const started = performance.now();
    try {
      const built = request.kind === 'entry' ? entryRequest(module, target, request) : compressRequest(module, target, request.entryIds);
      const model = prefs.helperModel && connection.models.includes(prefs.helperModel) ? prefs.helperModel : connection.model;
      const result = await narrate(built.messages, model, connection.mode, { maxTokens: built.maxTokens, temperature: 0.5 });
      const text = cleanSuggestion(result.text);
      logCall({ at: new Date().toLocaleTimeString(), purpose: 'journal', ok: true, ms: Math.round(performance.now() - started), message: `${request.kind === 'entry' ? 'Entry' : 'Compression'} suggested, ${text.length} characters`, diagnostics: result.diagnostics ?? null });
      if (!text) throw new Error('The suggestion came back empty.');
      setSave((current) => (current.journal.pending ? current : setPending(current, request.kind === 'entry' ? { ...request, text } : { ...request, text })));
    } catch (error) {
      failedAt.current = target.turns.length;
      const message = error instanceof Error ? error.message : 'The journal suggestion failed.';
      logCall({ at: new Date().toLocaleTimeString(), purpose: 'journal', ok: false, ms: 0, message, diagnostics: error instanceof NarrationError ? error.diagnostics : null });
    } finally {
      suggesting.current = false;
      setJournalBusy(false);
    }
  }

  // Ask for a journal entry when story is about to leave the window, and for a compression
  // when the journal is over its budget. Never while narrating, and never twice at once.
  useEffect(() => {
    if (busy || suggesting.current || !connection.connected || save.journal.pending) return;
    if (failedAt.current === save.turns.length) return;
    if (save.options.autoJournal) {
      const due = journalDue(module, save);
      if (due) { void suggest(save, { kind: 'entry', ...due }); return; }
    }
    if (save.options.autoCompress) {
      const ids = compressionDue(save);
      if (ids) void suggest(save, { kind: 'compress', entryIds: ids });
    }
  });

  function send() {
    const result = say(module, save, newId('t'), draft);
    if (!result.ok) { setNotice(result.reason); return; }
    setDraft('');
    setSave(result.save);
    void runNarration(result.save);
  }

  function perform(action: Action) {
    const result = act(module, save, newId('t'), action);
    if (!result.ok) { setNotice(result.reason); return; }
    setSave(result.save);
    setCheck(null);
    const terminal = result.terminals[0];
    setNotice(terminal ? terminal.note : '');
    void runNarration(result.save);
  }

  // Back from a screen in the menu space to the menu, with the open section in view.
  function backToMenu() {
    setPage('menu');
    if (section !== 'none') bringToTop(sectionAnchor(section));
  }

  function closeCheck() {
    const fromMenu = check?.fromMenu;
    setCheck(null);
    if (fromMenu && section !== 'none') bringToTop(sectionAnchor(section));
  }

  function undo() {
    pending.current?.abort();
    setBusy(false);
    const result = undoLastTurn(save);
    if (!result.ok) { setNotice(result.reason); return; }
    setSave(result.save);
    if (result.turn.kind === 'say') setDraft(result.turn.input);
    setNotice('The last turn was undone.');
  }

  function stop() {
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
    setNotice('Stopped. Reroll to try again.');
  }

  const api: PlayApi = {
    module,
    world,
    save,
    name,
    prefs,
    setPrefs,
    connection,
    setConnection,
    busy,
    journalBusy,
    calls,
    lastPlan,
    commit: (next, message) => { setSave(next); if (message !== undefined) setNotice(message); },
    notify: setNotice,
    perform,
    setValue: (defId, owner, value) => {
      const result = setState(module, save, defId, owner, value);
      if (!result.ok) { setNotice(result.reason); return; }
      setSave(result.save);
      const terminal = result.terminals[0];
      setNotice(terminal ? terminal.note : '');
    },
    putSelf: (placeId) => {
      const result = placeCharacter(module, save, playerId, placeId);
      if (!result.ok) { setNotice(result.reason); return; }
      setSave(result.save);
      showLatest();
      const place = world.world.places.find((entry) => entry.id === placeId);
      setNotice(`You are at ${inSentence(place?.name ?? placeId)}, by your own hand. The narrator will see it on your next turn.`);
    },
    talkTo: (person) => {
      setDraft((current) => current || `I turn to ${inSentence(person)}. `);
      setCheck(null);
      setTimeout(() => { composer.current?.focus({ preventScroll: true }); showLatest(); }, 0);
    },
    lookUp: (query) => { setWorldQuery(query); setSection('world'); setPage('menu'); bringToTop(sectionAnchor('world')); },
    open: (next, nextSection) => {
      if (next === 'story') { setCheck(null); showLatest(); return; }
      if (nextSection) setSection(nextSection);
      setPage(next);
      if (next === 'menu') bringToTop(nextSection ? sectionAnchor(nextSection) : 'menu-space');
    },
    editRecord: (target) => { setRecordTarget(target); setPage('record'); },
    openCheck: (owner) => {
      const menu = document.getElementById('menu-space');
      setCheck({ owner, fromMenu: Boolean(menu && menu.getBoundingClientRect().top < window.innerHeight / 2) });
    },
    draft,
    clearDraft: () => setDraft(''),
    suggestEntry: () => {
      const range = uncoveredTurns(save);
      if (!range) { setNotice('Every narrated turn is already in the journal.'); return; }
      failedAt.current = -1;
      void suggest(save, { kind: 'entry', ...range });
    },
    suggestCompression: () => {
      const ids = compressionDue({ ...save, options: { ...save.options, journalTokens: 0 }, journal: { ...save.journal, compressDeclinedAt: 0 } });
      if (!ids) { setNotice('There need to be at least two entries to combine.'); return; }
      failedAt.current = -1;
      void suggest(save, { kind: 'compress', entryIds: ids });
    },
    leave: onClose,
  };

  const actions = sceneActionsFor(world, save);
  // Quick ways out for the chips: open, and under an hour.
  const openExits = scene.exits.filter((exit) => !exit.blocked && exit.edge.minutes <= 60).slice(0, 2);
  const pendingSuggestion = save.journal.pending;
  const canCheck = world.ruleset.approaches.length > 0 && targetsHere(world, save).length > 0;

  return (
    <div className="play">
      <section className="log" aria-label="Story" aria-live="polite">
        {module.scenario.opening && <article aria-label="Narrator"><RichText text={module.scenario.opening} /></article>}
        {save.turns.map((turn, index) => (
          <div key={turn.id} className="turn" id={turn === latest ? 'latest-turn' : undefined}>
            <TurnView
              world={world}
              save={save}
              turn={turn}
              next={save.turns[index + 1]}
              latest={turn === latest}
              busy={busy}
              connected={connection.connected}
              onReroll={() => void runNarration(save)}
              onUndo={undo}
              onStop={stop}
              model={calls.find((call) => call.purpose === 'narration' && call.ok)}
            />
          </div>
        ))}
      </section>

      <section
        id="prompt"
        className={`prompt${check ? ' checking' : ''}`}
        aria-label="Your turn"
        onKeyDown={(event: KeyboardEvent<HTMLElement>) => { if (event.key === 'Escape' && check) closeCheck(); }}
      >
        {notice && <p className="notice" role="status">{notice}</p>}
        {check ? (
          <CheckPanel key={check.owner ?? 'any'} api={api} owner={check.owner} headRef={checkHead} onCancel={closeCheck} />
        ) : (
          <>
            {pendingSuggestion && (
              <button type="button" className="ready-bar" onClick={() => api.open('journal')}>
                <span aria-hidden="true" className="dot" style={{ width: 8, height: 8, background: 'var(--you)' }} />
                <span style={{ flex: 1 }}>{pendingSuggestion.kind === 'entry' ? 'A journal entry is ready to review' : 'A shorter journal is ready to review'}</span>
                <b>Review</b>
              </button>
            )}
            <div className="chips" aria-label="Things you can do here">
              {actions.map((action) => (
                <button key={action.id} type="button" className="chip" disabled={busy} onClick={() => perform({ type: 'scene', actionId: action.id })}>{action.name}</button>
              ))}
              {canCheck && (
                <button type="button" className="chip" disabled={busy} onClick={() => api.openCheck()}>
                  <DiamondIcon />Make a check
                </button>
              )}
              <button type="button" className="chip" disabled={busy} onClick={() => perform({ type: 'wait', minutes: 10 })}>Wait 10 min</button>
              {openExits.map((exit) => (
                <button key={exit.place.id} type="button" className="chip" disabled={busy} onClick={() => perform({ type: 'travel', to: exit.place.id })}>
                  {exit.place.name} · {durationWords(exit.edge.minutes)}
                </button>
              ))}
            </div>
            <div className="compose-row">
              <label htmlFor="turn-input" className="sr">Your turn</label>
              <textarea
                id="turn-input"
                ref={composer}
                rows={2}
                value={draft}
                placeholder='Your turn: *action*, "speech", [thought]'
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); send(); }
                }}
              />
              <button type="button" className="send" aria-label="Send" onClick={send} disabled={busy || !draft.trim()}><SendIcon /></button>
            </div>
          </>
        )}
      </section>

      <section
        id="menu-space"
        className={`menu-space${page === 'menu' ? '' : ' paged'}`}
        aria-label="Menu"
        onKeyDown={(event: KeyboardEvent<HTMLElement>) => { if (event.key === 'Escape' && page !== 'menu') backToMenu(); }}
      >
        {page === 'journal' ? <JournalPanel api={api} headRef={pageHead} onBack={backToMenu} />
          : page === 'guide' ? <GuidePanel headRef={pageHead} onBack={backToMenu} />
          : page === 'record' ? <RecordPanel key={JSON.stringify(recordTarget)} api={api} target={recordTarget} headRef={pageHead} onDone={backToMenu} />
          : <Menu api={api} section={section} setSection={setSection} worldQuery={worldQuery} setWorldQuery={setWorldQuery} />}
      </section>
    </div>
  );
}

// Scrolls so the element with this id starts at the top of the screen, once it has rendered.
function bringToTop(id: string) {
  setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }), 0);
}

// Whether the player has scrolled down into the menu: its top is in the upper half.
function readingMenu(): boolean {
  const menu = document.getElementById('menu-space');
  return Boolean(menu && menu.getBoundingClientRect().top < window.innerHeight / 2);
}

// Shows the end of the story: the prompt at the foot of the screen, unless the latest turn
// is taller than the screen, in which case the turn's start, so it reads from the top.
function showLatest() {
  setTimeout(() => {
    const prompt = document.getElementById('prompt');
    if (!prompt) return;
    const y = window.scrollY;
    const view = window.innerHeight;
    let top = y + prompt.getBoundingClientRect().bottom - view + 12;
    const turn = document.getElementById('latest-turn');
    if (turn) top = Math.min(top, y + turn.getBoundingClientRect().top - 16);
    window.scrollTo({ top: Math.max(0, top) });
  }, 0);
}

function TurnView({ world, save, turn, next, latest, busy, connected, onReroll, onUndo, onStop, model }: {
  world: PraxisModule;
  save: Save;
  turn: Turn;
  next: Turn | undefined;
  latest: boolean;
  busy: boolean;
  connected: boolean;
  onReroll: () => void;
  onUndo: () => void;
  onStop: () => void;
  model: Call | undefined;
}) {
  // Hidden states (momentum) stay out of the story; the ledger in Settings still has them.
  const entries = save.ledger.slice(turn.ledgerStart, next ? next.ledgerStart : save.ledger.length)
    .filter((entry) => entry.kind !== 'state' || world.ruleset.states.find((def) => def.id === entry.defId)?.display !== 'hidden');
  const waiting = latest && busy && !turn.reply;
  return (
    <>
      <section className="turn-you" aria-label="Your turn">
        <div className="who"><b>You</b><span>{timeOfDay(turn.before.clock)}</span></div>
        <RichText text={turn.input} />
      </section>
      {turn.check && <CheckCard check={turn.check} />}
      {entries.length > 0 && (
        <div className="changes" aria-label="What changed">
          {entries.map((entry, index) => (
            <div key={index} className="change">
              <span className="what">{describeEntry(world, entry)}</span>
              <SourceTag source={entry.source} />
            </div>
          ))}
        </div>
      )}
      {turn.reply ? <article aria-label="Narrator"><RichText text={turn.reply} /></article>
        : waiting ? <p className="writing">The narrator is writing…</p>
        : latest ? <p className="muted" style={{ fontSize: 14 }}>{connected ? 'Not narrated yet.' : 'Not narrated. Connect NovelAI in Settings to have turns narrated.'}</p>
        : null}
      {latest && (
        <div className="turn-tools">
          {waiting ? (
            <button type="button" className="ghost" onClick={onStop}><StopIcon />Stop</button>
          ) : (
            <button type="button" className="ghost" onClick={onReroll} disabled={!connected}><RerollIcon />{turn.reply ? 'Reroll' : 'Narrate'}</button>
          )}
          <button type="button" className="ghost" onClick={onUndo}><UndoIcon />Undo turn</button>
          {model && turn.reply && <span className="meta">{[typeof model.diagnostics?.model === 'string' ? model.diagnostics.model : '', model.ms ? `${(model.ms / 1000).toFixed(1)} s` : ''].filter(Boolean).join(' · ')}</span>}
        </div>
      )}
    </>
  );
}
