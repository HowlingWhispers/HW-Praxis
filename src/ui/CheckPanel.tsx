// Making a check: what you are trying, who or what it is aimed at, the approach and what it
// does to them, a charge, the dice and exact odds, what is at stake, then roll or simply
// succeed. Anything the story mentions can be added on the spot and aimed at.
import { useState, type RefObject } from 'react';
import {
  DIFFICULTY_NAMES, actsOn, addObstacle, chargesOf, planCheck, playerOf, read, stateDefFor, subjectsHere,
  type Act, type CheckChoice, type Level, type Subject, type Target, type Tier,
} from '../engine';
import type { PlayApi } from './Play';
import { BackIcon, PlusIcon } from './icons';
import { Die } from './CheckCard';
import { newId } from './shared';

const percent = (value: number) => `${Math.round(value * 100)}%`;
const KIND_WORD: Record<Subject['kind'], string> = { person: 'Person', thing: 'Thing', place: 'This place' };

function actWords(act: Act): { claim: string; what: string } {
  if (act.kind === 'deed') return { claim: 'A deed', what: act.deed.label };
  const verb = act.def.verb ?? (act.def.grows ? `Builds ${act.def.name}` : `Wears down ${act.def.name}`);
  if (act.claim === 'secondary') return { claim: 'Secondary', what: `${verb} (+1 setback)` };
  return { claim: act.def.grows ? 'Builds' : 'Owns this', what: verb };
}

const targetOf = (subject: Subject, act: Act | undefined): Target | null => (act ? { owner: subject.id, defId: act.kind === 'deed' ? null : act.def.id } : null);

export function CheckPanel({ api, owner, headRef, onCancel }: { api: PlayApi; owner?: string; headRef: RefObject<HTMLDivElement>; onCancel: () => void }) {
  const { world, save, busy } = api;
  const playerId = playerOf(world);
  const subjects = subjectsHere(world, save);
  const [subjectId, setSubjectId] = useState(owner ?? subjects[0]?.id ?? '');
  const subject = subjects.find((entry) => entry.id === subjectId) ?? subjects[0];
  const options = subject ? actsOn(world, save, subject) : [];
  const bestFor = (approachId: string) => {
    const slots = chargesOf(world, save, playerId).find((entry) => entry.approach === approachId)?.slots ?? [];
    return Math.max(0, ...slots.filter((slot) => !slot.spent).map((slot) => slot.value));
  };
  const firstUsable = (list: typeof options) => list.find((entry) => entry.acts.length)?.approach.id ?? list[0]?.approach.id ?? '';
  const [choice, setChoice] = useState<CheckChoice>(() => {
    const approach = firstUsable(options);
    return { approach, charge: bestFor(approach), push: false, storyPoint: false, useAids: true };
  });
  const [actIndex, setActIndex] = useState(0);
  const [line, setLine] = useState(api.draft);
  const [adding, setAdding] = useState(false);

  const current = options.find((entry) => entry.approach.id === choice.approach);
  const act = current?.acts[Math.min(actIndex, Math.max(0, (current?.acts.length ?? 1) - 1))];
  const target = subject ? targetOf(subject, act) : null;

  function pickSubject(next: Subject) {
    setSubjectId(next.id);
    setActIndex(0);
    const nextOptions = actsOn(world, save, next);
    // Keep the approach when it can do something here; otherwise the first that can.
    if (!nextOptions.find((entry) => entry.approach.id === choice.approach)?.acts.length) {
      const approach = firstUsable(nextOptions);
      setChoice({ ...choice, approach, charge: bestFor(approach), push: false });
    }
  }

  function pickApproach(approachId: string) {
    setActIndex(0);
    setChoice({ ...choice, approach: approachId, charge: bestFor(approachId), push: false });
  }

  if (!subject || !world.ruleset.approaches.length) {
    return (
      <div>
        <div className="panel-head" ref={headRef} tabIndex={-1}>
          <button type="button" className="btn quiet" onClick={onCancel} style={{ paddingLeft: 4 }}><BackIcon />Cancel</button>
          <h1>Make a check</h1>
          <span className="spacer" />
        </div>
        <div className="panel-body"><p className="meta">This world has no approaches to check with.</p></div>
      </div>
    );
  }

  const plan = target ? planCheck(world, save, target, choice) : null;
  const slots = chargesOf(world, save, playerId).find((entry) => entry.approach === choice.approach)?.slots ?? [];
  const dice = world.ruleset.dice;
  const storyPoints = dice?.storyPoints ? stateDefFor(world, dice.storyPoints, playerId) : undefined;
  const spValue = storyPoints ? read(save.values, storyPoints, playerId) : 0;
  const alwaysSucceed = save.options.alwaysSucceed;
  const aids = plan?.ok ? plan.aids.filter((aid) => aid.def.approach?.owner !== choice.approach) : [];

  function settle(roll: boolean) {
    if (!target) return;
    api.perform({ type: 'check', target, choice, input: line, random: roll ? Math.random : null });
    if (line.trim() && line === api.draft) api.clearDraft();
  }

  return (
    <div>
      <div className="panel-head" ref={headRef} tabIndex={-1}>
        <button type="button" className="btn quiet" onClick={onCancel} style={{ paddingLeft: 4 }}><BackIcon />Cancel</button>
        <h1>Make a check</h1>
        <button type="button" className="btn quiet small" onClick={() => api.open('guide')}>How it works</button>
      </div>
      <div className="panel-body">
        <div>
          <label htmlFor="check-line" className="label field-label">What you’re trying to do</label>
          <textarea id="check-line" className="area" rows={2} value={line} placeholder="Your line in the story, such as: I put my shoulder to the door." onChange={(event) => setLine(event.target.value)} />
        </div>

        <div>
          <span id="check-target" className="label field-label">Against</span>
          <div className="card clip rows" role="radiogroup" aria-labelledby="check-target">
            {subjects.map((entry) => {
              const on = entry.id === subject.id;
              const person = world.characters.find((character) => character.id === entry.id);
              const meta = [KIND_WORD[entry.kind], person?.tier, entry.local ? 'yours' : ''].filter(Boolean).join(' · ');
              return (
                <button key={entry.id} type="button" role="radio" aria-checked={on} className={`lr target${on ? ' on' : ''}`} onClick={() => pickSubject(entry)}>
                  <span className="grow">
                    <span className="name" style={{ display: 'block' }}>{entry.name}</span>
                    <span className="meta" style={{ display: 'block', marginTop: 2 }}>{meta}</span>
                  </span>
                  <span className="radio" aria-hidden="true" />
                </button>
              );
            })}
            {!adding ? (
              <button type="button" className="lr" onClick={() => setAdding(true)}>
                <PlusIcon /><span className="grow"><span className="name" style={{ display: 'block' }}>Something in the story</span><span className="meta" style={{ display: 'block', marginTop: 2 }}>A door, a crowd, two guards: add it and aim at it</span></span>
              </button>
            ) : (
              <SomethingForm
                onCancel={() => setAdding(false)}
                onAdd={(input) => {
                  const id = newId(input.kind === 'person' ? 'person' : 'thing');
                  const result = addObstacle(api.module, save, { id, ...input });
                  if (!result.ok) { api.notify(result.reason); return; }
                  api.commit(result.save, `${input.name} is in your records now, here.`);
                  setAdding(false);
                  setSubjectId(id);
                  setActIndex(0);
                }}
              />
            )}
          </div>
        </div>

        <div>
          <span id="check-approach" className="label field-label">Approach</span>
          <div className="appr-grid" role="radiogroup" aria-labelledby="check-approach">
            {options.map(({ approach, acts, difficulty }) => {
              const ratingDef = stateDefFor(world, approach.id, playerId);
              const rating = ratingDef ? read(save.values, ratingDef, playerId) : 0;
              const on = choice.approach === approach.id;
              const words = acts[0] ? actWords(acts[0]) : { claim: 'No claim', what: `Nothing to do to ${subject.name.replace(/^The /, 'the ')}` };
              return (
                <button
                  key={approach.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={!acts.length}
                  className={`appr ${approach.id}${on ? ' on' : ''}`}
                  onClick={() => pickApproach(approach.id)}
                >
                  <span className="top"><span className="an">{approach.name}</span><span className="ar">{rating}</span></span>
                  <span className="ac">{words.claim}{acts.length ? <span className="ad"> · {DIFFICULTY_NAMES[difficulty]}</span> : null}</span>
                  <span className="ax">{words.what}</span>
                </button>
              );
            })}
          </div>
          {current && current.acts.length > 1 && (
            <div className="seg" role="group" aria-label="What it works on" style={{ marginTop: 8 }}>
              {current.acts.map((entry, index) => (
                <button key={entry.kind === 'deed' ? 'deed' : entry.def.id} type="button" aria-pressed={index === actIndex} onClick={() => setActIndex(index)}>
                  {entry.kind === 'deed' ? 'A deed' : `${entry.def.name}${entry.claim === 'secondary' ? ' (+1 setback)' : ''}`}
                </button>
              ))}
            </div>
          )}
        </div>

        {slots.length > 0 && (
          <div>
            <span id="check-charge" className="label field-label">Charge</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }} role="radiogroup" aria-labelledby="check-charge">
              <button type="button" role="radio" aria-checked={choice.charge === 0} className={`cchip${choice.charge === 0 ? ' on' : ''}`} onClick={() => setChoice({ ...choice, charge: 0, push: false })}>None</button>
              {slots.map((slot) => {
                const on = choice.charge === slot.value;
                const canPush = slot.spent && Boolean(dice?.push);
                return (
                  <button
                    key={slot.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={slot.spent && !canPush}
                    className={`cchip${on ? ' on' : ''}${slot.spent ? ' spent' : ''}`}
                    onClick={() => setChoice({ ...choice, charge: slot.value, push: slot.spent })}
                  >
                    +{slot.value}{slot.spent ? ' · push' : ''}
                  </button>
                );
              })}
            </div>
            <p className="hint">Spent charges come back when every charge on this approach is used, or after a full rest.{dice?.push ? ' Pushing reuses a spent one at a cost.' : ''}</p>
          </div>
        )}

        {aids.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="grow" style={{ flex: 1 }}>
              <span id="check-aids" className="name" style={{ display: 'block' }}>Use what you’ve built</span>
              <span className="meta" style={{ display: 'block', marginTop: 2, lineHeight: 1.4 }}>
                {aids.map((aid) => `${aid.def.name} ${aid.value}: ${aid.def.aids === 'easier' ? `${aid.value === 1 ? 'one step' : `${aid.value} steps`} easier` : `${aid.value === 1 ? 'one boost die' : `${aid.value} boost dice`}`}`).join('; ')}. Spent on this check.
              </span>
            </span>
            <button type="button" className="switch" role="switch" aria-checked={choice.useAids !== false} aria-labelledby="check-aids" onClick={() => setChoice({ ...choice, useAids: choice.useAids === false })} />
          </div>
        )}

        {storyPoints && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="grow" style={{ flex: 1 }}>
              <span id="check-sp" className="name" style={{ display: 'block' }}>Spend your Story Point</span>
              <span className="meta" style={{ display: 'block', marginTop: 2, lineHeight: 1.4 }}>
                {spValue > 0 ? 'Upgrades one of your dice. Then it is the rules’ to spend.' : 'You have none. The rules hold both, so they spend one on this roll.'}
              </span>
            </span>
            <button type="button" className="switch" role="switch" aria-checked={Boolean(choice.storyPoint)} aria-labelledby="check-sp" disabled={spValue < 1} onClick={() => setChoice({ ...choice, storyPoint: !choice.storyPoint })} />
          </div>
        )}

        {plan?.ok ? (
          <>
            <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="dice-row" style={{ minHeight: 36 }}>
                {plan.pool.good.map((kind, index) => <Die key={`g${index}`} kind={kind} />)}
                <span className="vs">vs</span>
                {plan.pool.bad.length ? plan.pool.bad.map((kind, index) => <Die key={`b${index}`} kind={kind} />) : <span className="meta">nothing</span>}
              </div>
              <p className="meta" style={{ lineHeight: 1.45 }}>
                {[`${plan.difficulty.name} difficulty${plan.difficulty.final !== plan.difficulty.base ? ` (from ${DIFFICULTY_NAMES[plan.difficulty.base]})` : ''}`, ...plan.reasons].join('. ')}.
              </p>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                <span style={{ font: '600 40px/1 var(--mono)' }}>{percent(plan.odds.success)}</span>
                <span style={{ fontSize: 15, color: 'var(--text-2)' }}>chance to succeed</span>
              </div>
              <div className="two">
                <div className="stat"><b>{percent(plan.odds.extra)}</b><span>an extra success</span></div>
                <div className="stat"><b>{percent(plan.odds.advantage2)}</b><span>Edge, from 2+ advantage</span></div>
                <div className="stat"><b>{percent(plan.odds.threat2)}</b><span>trouble, from 2+ threat</span></div>
                <div className="stat"><b>{percent(plan.odds.triumph)}</b><span>a triumph</span></div>
              </div>
              <p className="meta">Exact, from every face of every die.</p>
            </div>

            <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--text-2)' }}><b className="good">Success:</b> {plan.stakes.success}</p>
              <p style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--text-2)' }}><b className="bad">Failure:</b> {plan.stakes.failure.length ? `${plan.stakes.failure.join('; ')}.` : 'Nothing moves.'}{plan.claim === 'secondary' ? ` ${plan.approach.name} is on ${plan.paying.name}’s ground, so it pays ${plan.paying.name}’s cost.` : ''}</p>
              {plan.stakes.threat.length > 0 && <p style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--text-2)' }}><b>Two or more threat:</b> {plan.stakes.threat.join('; ')}.</p>}
            </div>
          </>
        ) : (
          <p className="notice warn" role="alert">{plan ? plan.reason : `${current?.approach.name ?? 'That approach'} has nothing to do to ${subject.name.replace(/^The /, 'the ')}. Pick another.`}</p>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          {alwaysSucceed ? (
            <>
              <button type="button" className="btn" style={{ flex: 1, minHeight: 52 }} disabled={busy || !plan?.ok} onClick={() => settle(true)}>Roll anyway</button>
              <button type="button" className="btn primary" style={{ flex: 1, minHeight: 52 }} disabled={busy || !plan?.ok} onClick={() => settle(false)}>Succeed</button>
            </>
          ) : (
            <>
              <button type="button" className="btn" style={{ flex: 1, minHeight: 52 }} disabled={busy || !plan?.ok} onClick={() => settle(false)}>Succeed, no roll</button>
              <button type="button" className="btn primary" style={{ flex: 1, minHeight: 52 }} disabled={busy || !plan?.ok} onClick={() => settle(true)}>Roll</button>
            </>
          )}
        </div>
        <p className="hint" style={{ textAlign: 'center' }}>Succeeding without a roll moves it by one and costs nothing. The ledger records that you decided.</p>
      </div>
    </div>
  );
}

const LEVELS: [Level, string][] = [[1, 'Easy'], [2, 'Average'], [3, 'Hard'], [4, 'Daunting'], ['random', 'Random']];
const TIER_WORDS: [Tier, string][] = [['minion', 'Minion'], ['rival', 'Rival'], ['nemesis', 'Nemesis']];

// Adds something the story mentions: a person, a group of people, or a thing, here and now.
function SomethingForm({ onAdd, onCancel }: { onAdd: (input: { kind: 'person' | 'thing'; name: string; summary?: string; difficulty: Level; tier?: Tier }) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'person' | 'people' | 'thing'>('thing');
  const [difficulty, setDifficulty] = useState<Level>(2);
  const [tier, setTier] = useState<Tier>('minion');
  return (
    <form
      className="lr stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        onAdd({
          kind: kind === 'thing' ? 'thing' : 'person',
          name: name.trim(),
          summary: kind === 'people' ? 'A group' : undefined,
          difficulty,
          tier: kind === 'thing' ? undefined : tier,
        });
      }}
    >
      <label htmlFor="something-name" className="name">Something in the story</label>
      <input id="something-name" className="field" value={name} placeholder="The warehouse door, two dock guards…" onChange={(event) => setName(event.target.value)} autoFocus />
      <div className="seg" role="group" aria-label="What it is">
        {([['thing', 'A thing'], ['person', 'A person'], ['people', 'A group']] as const).map(([value, label]) => (
          <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)}>{label}</button>
        ))}
      </div>
      <div className="seg wrap" role="group" aria-label="How hard">
        {LEVELS.map(([value, label]) => (
          <button key={String(value)} type="button" aria-pressed={difficulty === value} onClick={() => setDifficulty(value)}>{label}</button>
        ))}
      </div>
      {kind !== 'thing' && (
        <div className="seg" role="group" aria-label="Tier">
          {TIER_WORDS.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={tier === value} onClick={() => setTier(value)}>{label}</button>
          ))}
        </div>
      )}
      <span className="meta" style={{ lineHeight: 1.45 }}>It joins your records, here. Random rolls a difficulty for each approach, fixed for this save.</span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn primary" style={{ flex: 1 }} disabled={!name.trim()}>Add and aim</button>
        <button type="button" className="btn quiet" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
