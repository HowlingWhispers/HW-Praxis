// Dice as they look on screen, and the receipt a check leaves in the story.
import type { CheckRecord } from '../engine';

const DIE_NAMES: Record<string, string> = {
  ability: 'Ability die', proficiency: 'Proficiency die', boost: 'Boost die',
  difficulty: 'Difficulty die', challenge: 'Challenge die', setback: 'Setback die',
};
const SYMBOL_NAMES: Record<string, string> = { S: 'success', A: 'advantage', R: 'triumph', F: 'failure', T: 'threat', D: 'despair' };

export function faceText(face: string): string {
  return face.replace('R', '✦').replace('D', '×');
}

// One die. `face` undefined shows it unrolled; '' is a blank face.
export function Die({ kind, face }: { kind: string; face?: string }) {
  const words = face === undefined ? '' : face ? `: ${face.split('').map((symbol) => SYMBOL_NAMES[symbol] ?? symbol).join(', ')}` : ': blank';
  return (
    <span className={`die ${kind}`}>
      {face === undefined ? null : <span aria-hidden="true" className="face">{face ? faceText(face) : '–'}</span>}
      <span className="sr">{DIE_NAMES[kind] ?? kind}{words}</span>
    </span>
  );
}

export function verdictOf(check: Pick<CheckRecord, 'succeeded' | 'netSuccess' | 'triumph' | 'despair' | 'partial'>): string {
  if (check.succeeded) return `${check.triumph ? 'Triumph' : 'Success'}${check.netSuccess > 1 ? ` +${check.netSuccess - 1}` : ''}${check.partial ? ', not over yet' : ''}`;
  return check.despair ? 'Despair' : 'Failure';
}

export function tallyText(check: Pick<CheckRecord, 'succeeded' | 'netSuccess' | 'netAdvantage'>): string {
  const parts = [check.succeeded ? `${check.netSuccess} net ${check.netSuccess === 1 ? 'success' : 'successes'}` : 'no net success'];
  if (check.netAdvantage > 0) parts.push(`${check.netAdvantage} advantage`);
  if (check.netAdvantage < 0) parts.push(`${-check.netAdvantage} threat`);
  return parts.join(' · ');
}

export function CheckCard({ check }: { check: CheckRecord }) {
  return (
    <section className="check-card" aria-label="Check">
      <div className="check-head">
        <span className={`appr-tag ${check.approach}`}>
          <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 22 12 12 22 2 12z" /></svg>
          {check.approachName}
        </span>
        <span className="check-target">{check.target.label}</span>
      </div>
      {check.intent && <p className="meta" style={{ margin: '6px 0 0', lineHeight: 1.4 }}>Wanted: {check.intent}</p>}
      {!check.auto && (
        <div className="dice-row">
          {check.good.map((die, index) => <Die key={`g${index}`} kind={die.kind} face={die.face} />)}
          <span className="vs">vs</span>
          {check.bad.map((die, index) => <Die key={`b${index}`} kind={die.kind} face={die.face} />)}
        </div>
      )}
      <div className="verdict-row">
        <strong className={check.succeeded ? 'good' : 'bad'}>{verdictOf(check)}</strong>
        <span className="meta">{check.auto ? 'settled without rolling, by your choice' : `${tallyText(check)} · had ${Math.round(check.chance * 100)}%`}</span>
      </div>
    </section>
  );
}
