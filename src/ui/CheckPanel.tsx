// Making a check: what you are trying, against what, with which approach and charge, the
// dice and exact odds, what is at stake, then roll or simply succeed.
import { useState, type RefObject } from 'react';
import { chargesOf, claimOf, planCheck, playerOf, read, stateDefFor, targetsHere, type CheckChoice } from '../engine';
import type { PlayApi } from './Play';
import { BackIcon } from './icons';
import { Die } from './CheckCard';

const percent = (value: number) => `${Math.round(value * 100)}%`;

export function CheckPanel({ api, owner, headRef, onCancel }: { api: PlayApi; owner?: string; headRef: RefObject<HTMLDivElement>; onCancel: () => void }) {
  const { world, save, busy } = api;
  const playerId = playerOf(world);
  const targets = targetsHere(world, save);
  const first = targets.find((target) => target.owner === owner) ?? targets[0];
  const [targetKey, setTargetKey] = useState(first ? `${first.owner}:${first.defId}` : '');
  const target = targets.find((entry) => `${entry.owner}:${entry.defId}` === targetKey) ?? first;
  const approaches = world.ruleset.approaches;
  const bestFor = (approachId: string) => {
    const slots = chargesOf(world, save, playerId).find((entry) => entry.approach === approachId)?.slots ?? [];
    return Math.max(0, ...slots.filter((slot) => !slot.spent).map((slot) => slot.value));
  };
  const firstApproach = target ? approaches.find((approach) => claimOf(target.def, approach.id) === 'owner') ?? approaches[0] : approaches[0];
  const [choice, setChoice] = useState<CheckChoice>({ approach: firstApproach?.id ?? '', charge: firstApproach ? bestFor(firstApproach.id) : 0, push: false, storyPoint: false });
  const [line, setLine] = useState(api.draft);

  if (!target || !approaches.length) {
    return (
      <div>
        <div className="panel-head" ref={headRef} tabIndex={-1}>
          <button type="button" className="btn quiet" onClick={onCancel} style={{ paddingLeft: 4 }}><BackIcon />Cancel</button>
          <h1>Make a check</h1>
          <span className="spacer" />
        </div>
        <div className="panel-body"><p className="meta">There is nothing here a check can move.</p></div>
      </div>
    );
  }

  const plan = planCheck(world, save, target, choice);
  const slots = chargesOf(world, save, playerId).find((entry) => entry.approach === choice.approach)?.slots ?? [];
  const dice = world.ruleset.dice;
  const storyPoints = dice?.storyPoints ? stateDefFor(world, dice.storyPoints, playerId) : undefined;
  const spValue = storyPoints ? read(save.values, storyPoints, playerId) : 0;
  const alwaysSucceed = save.options.alwaysSucceed;

  function pickTarget(key: string) {
    setTargetKey(key);
    const next = targets.find((entry) => `${entry.owner}:${entry.defId}` === key);
    if (!next) return;
    // Aim with the approach that owns it; the player can still pick a secondary.
    if (claimOf(next.def, choice.approach) !== 'owner') {
      const owner = approaches.find((approach) => claimOf(next.def, approach.id) === 'owner');
      if (owner) setChoice({ ...choice, approach: owner.id, charge: bestFor(owner.id), push: false });
    }
  }

  function settle(roll: boolean) {
    if (!target) return;
    api.perform({ type: 'check', target: { owner: target.owner, defId: target.defId }, choice, input: line, random: roll ? Math.random : null });
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
          <textarea id="check-line" className="area" rows={2} value={line} placeholder="Your line in the story, such as: Let me through on my word." onChange={(event) => setLine(event.target.value)} />
        </div>

        <div>
          <span id="check-target" className="label field-label">Against</span>
          <div className="card clip rows" role="radiogroup" aria-labelledby="check-target">
            {targets.map((entry) => {
              const key = `${entry.owner}:${entry.defId}`;
              const on = key === targetKey || (!targetKey && entry === first);
              return (
                <button key={key} type="button" role="radio" aria-checked={on} className={`lr target${on ? ' on' : ''}`} onClick={() => pickTarget(key)}>
                  <span className="grow">
                    <span className="name" style={{ display: 'block' }}>{entry.ownerName}</span>
                    <span className="meta" style={{ display: 'block', marginTop: 2 }}>{entry.def.name} · {entry.word}{api.prefs.showNumbers ? ` · ${entry.value}` : ''}</span>
                  </span>
                  <span className="radio" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <span id="check-approach" className="label field-label">Approach</span>
          <div className="appr-grid" role="radiogroup" aria-labelledby="check-approach">
            {approaches.map((approach) => {
              const claim = claimOf(target.def, approach.id);
              const ratingDef = stateDefFor(world, approach.id, playerId);
              const rating = ratingDef ? read(save.values, ratingDef, playerId) : 0;
              const on = choice.approach === approach.id;
              return (
                <button
                  key={approach.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={claim === 'none'}
                  className={`appr ${approach.id}${on ? ' on' : ''}`}
                  onClick={() => setChoice({ ...choice, approach: approach.id, charge: bestFor(approach.id), push: false })}
                >
                  <span className="top"><span className="an">{approach.name}</span><span className="ar">{rating}</span></span>
                  <span className="ac">{claim === 'owner' ? 'Owns this' : claim === 'secondary' ? 'Secondary' : 'No claim'}</span>
                  <span className="ax">{claim === 'owner' ? `Moves ${target.def.name}` : claim === 'secondary' ? '+1 setback die' : `Can’t move ${target.def.name}`}</span>
                </button>
              );
            })}
          </div>
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

        {plan.ok ? (
          <>
            <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="dice-row" style={{ minHeight: 36 }}>
                {plan.pool.good.map((kind, index) => <Die key={`g${index}`} kind={kind} />)}
                <span className="vs">vs</span>
                {plan.pool.bad.map((kind, index) => <Die key={`b${index}`} kind={kind} />)}
              </div>
              <p className="meta" style={{ lineHeight: 1.45 }}>
                {['Average difficulty', ...plan.reasons].join('. ')}.
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
          <p className="notice warn" role="alert">{plan.reason}</p>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          {alwaysSucceed ? (
            <>
              <button type="button" className="btn" style={{ flex: 1, minHeight: 52 }} disabled={busy || !plan.ok} onClick={() => settle(true)}>Roll anyway</button>
              <button type="button" className="btn primary" style={{ flex: 1, minHeight: 52 }} disabled={busy || claimOf(target.def, choice.approach) === 'none'} onClick={() => settle(false)}>Succeed</button>
            </>
          ) : (
            <>
              <button type="button" className="btn" style={{ flex: 1, minHeight: 52 }} disabled={busy || claimOf(target.def, choice.approach) === 'none'} onClick={() => settle(false)}>Succeed, no roll</button>
              <button type="button" className="btn primary" style={{ flex: 1, minHeight: 52 }} disabled={busy || !plan.ok} onClick={() => settle(true)}>Roll</button>
            </>
          )}
        </div>
        <p className="hint" style={{ textAlign: 'center' }}>Succeeding without a roll moves {target.def.name} by one and costs nothing. The ledger records that you decided.</p>
      </div>
    </div>
  );
}
