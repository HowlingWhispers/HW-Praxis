// Bonds: what lies between you and someone, in the bond's own words, and the way to start
// one, set it by hand or end it. The tiers are words; the number is only for setting by hand.
import { useState } from 'react';
import { bondBetween, bondKinds, bondsOf, playerOf, removeRecord, startBond, updateRecord, type Bond, type Character } from '../engine';
import type { PlayApi } from './Play';
import { ChevronRight } from './icons';
import { newId } from './shared';
import { ValueEditor } from './ValueEditor';

function BondBody({ api, bond }: { api: PlayApi; bond: Bond }) {
  const local = bond.relationship.origin === 'local';
  const [shape, setShape] = useState(bond.relationship.shape);
  const field = `bond-shape-${bond.relationship.id}`;
  return (
    <>
      {local ? (
        <form
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          onSubmit={(event) => {
            event.preventDefault();
            const result = updateRecord(api.module, api.save, bond.relationship.id, { description: shape.trim() });
            if (result.ok) api.commit(result.save, 'Saved. The narrator reads it when you are both in the scene.'); else api.notify(result.reason);
          }}
        >
          <label htmlFor={field} className="label">What lies between you</label>
          <textarea id={field} className="area" rows={3} value={shape} placeholder="Such as: She took my name at the gate and I owe her a favour for letting me through." onChange={(event) => setShape(event.target.value)} />
          <button type="submit" className="btn" disabled={shape.trim() === bond.relationship.shape}>Save</button>
        </form>
      ) : bond.relationship.shape && <p className="prose">{bond.relationship.shape}</p>}
      {bond.def && <ValueEditor def={bond.def} value={bond.value} onSet={(value) => api.setValue(bond.def!.id, bond.owner, value)} />}
      {bond.def?.approach && <p className="meta" style={{ lineHeight: 1.45 }}>A triumph with {nameOf(api, bond.def.approach.owner)} against {bond.other.name.replace(/^The /, 'the ')} warms it a tier; a despair cools it.</p>}
      {local && (
        <button
          type="button"
          className="btn quiet"
          onClick={() => {
            const result = removeRecord(api.module, api.save, bond.relationship.id);
            if (result.ok) api.commit(result.save, `The bond with ${bond.other.name.replace(/^The /, 'the ')} is gone from your records.`); else api.notify(result.reason);
          }}
        >
          End this bond
        </button>
      )}
    </>
  );
}

const nameOf = (api: PlayApi, approachId: string) => api.world.ruleset.approaches.find((approach) => approach.id === approachId)?.name ?? approachId;

// The bond between you and one person, or a way to start one, for that person's row.
export function BondWithYou({ api, person }: { api: PlayApi; person: Character }) {
  const { world, save } = api;
  const kinds = bondKinds(world);
  const bond = bondBetween(world, save, playerOf(world), person.id);
  const [kind, setKind] = useState(kinds[0]?.id ?? '');
  if (bond) {
    return (
      <div className="knows">
        <p className="label">Between you · {bond.def?.name ?? 'a bond'}</p>
        {bond.tier && <p className="prose-strong" style={{ marginTop: 6, fontSize: 15 }}>{bond.tier}</p>}
        <details style={{ marginTop: 8 }}>
          <summary className="meta" style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>More, or set it by hand</summary>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}><BondBody api={api} bond={bond} /></div>
        </details>
      </div>
    );
  }
  if (!kinds.length) return null;
  return (
    <form
      className="knows"
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
      onSubmit={(event) => {
        event.preventDefault();
        const result = startBond(api.module, save, newId('bond'), person.id, kind);
        if (result.ok) api.commit(result.save, `A bond with ${person.name.replace(/^The /, 'the ')}, kept in your records.`); else api.notify(result.reason);
      }}
    >
      <label htmlFor={`bond-${person.id}`} className="label">Start a bond</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <select id={`bond-${person.id}`} className="select" style={{ flex: 1 }} value={kind} onChange={(event) => setKind(event.target.value)}>
          {kinds.map((def) => <option key={def.id} value={def.id}>{def.name}</option>)}
        </select>
        <button type="submit" className="btn">Start</button>
      </div>
    </form>
  );
}

// Everyone you have a bond with, for the You section.
export function BondsSummary({ api }: { api: PlayApi }) {
  const { world, save } = api;
  const bonds = bondsOf(world, save, playerOf(world));
  return (
    <>
      <div className="sub"><p className="label">Bonds</p><span className="meta">{bonds.length || 'none yet'}</span></div>
      <div className="card clip rows">
        {bonds.map((bond) => (
          <details key={bond.relationship.id}>
            <summary className="row">
              <span className="row-text">
                <span className="name">{bond.other.name}</span>
                <span className="meta">{[bond.def?.name, bond.tier].filter(Boolean).join(' · ')}</span>
              </span>
              <ChevronRight />
            </summary>
            <div className="row-body"><BondBody api={api} bond={bond} /></div>
          </details>
        ))}
        {!bonds.length && <p className="meta" style={{ padding: '14px 16px', lineHeight: 1.45 }}>Start a bond with someone from their row in Scene. Its tier moves on a triumph or despair against them, and by your hand.</p>}
      </div>
    </>
  );
}
