// The state primitive, ported from Character Engine's state core.
//
// One bounded integer covers resources, tracks, conditions, standings and an encounter's
// progress. They differ only in scope, bounds, bands and terminals.
//
// Everything here is pure: values in, values and a ledger entry out. No storage, no clock,
// no randomness, so the same call always gives the same answer and every rule can be tested
// without a browser.
//
// Rules that hold for every function below:
// - A missing value is not an error and is never backfilled. Reads fall back to the
//   definition's start, so adding a definition to a running save writes nothing.
// - Clamping happens at the write. No value outside [min, max] can be stored.
// - A value reaches the model only through its bands, and only when it is off its resting
//   band. A definition with no bands never reaches the model.
// - Terminals fire on crossing, not on occupancy: moving 0 to 0 does not announce a death
//   twice, but stepping from one terminal straight into another counts as an arrival.

import { z } from 'zod';

export const STATE_SCOPES = [
  'world', // one value, owned by the world
  'char', // every character
  'protagonist', // only the player's character
  'npc', // every character except the player's
  'place',
  'item',
  'faction',
  'relationship', // a pair of characters; see pairKey
  'event', // a live encounter
] as const;
export type StateScope = (typeof STATE_SCOPES)[number];

export type OwnerKind = 'world' | 'character' | 'place' | 'item' | 'faction' | 'relationship' | 'event';

// What the play screen shows. The override surface always shows the number.
export const STATE_DISPLAYS = ['value', 'band', 'hidden'] as const;

const id = z.string().min(1).max(120);

export const stateBandSchema = z.object({
  // Inclusive lower bound. The first band is the floor whatever its own `at` says.
  at: z.number().int(),
  // The words the model and the player read, e.g. "is bruised".
  label: z.string().max(200),
});

export const stateTerminalSchema = z.object({
  // 'min' or 'max' fires at that bound. 'band' fires while the value sits in `band`.
  at: z.enum(['min', 'max', 'band']),
  // A band index. An index past the end never matches, which is the quiet failure an
  // author wants rather than a directive fired at the wrong step.
  band: z.number().int().nonnegative().optional(),
  // The directive. It replaces the roll's own directive rather than joining it.
  note: z.string().min(1).max(2000),
});

export const stateDefSchema = z.object({
  id,
  name: z.string().min(1).max(120),
  scope: z.enum(STATE_SCOPES),
  min: z.number().int(),
  max: z.number().int(),
  start: z.number().int(),
  bands: z.array(stateBandSchema).max(24).default([]),
  // 'value': a band's `at` is a value. 'share': it is a percentage of the way from min to the
  // owner's max, so one set of bands reads right for a player with 8 Health and a minion with 2.
  bandBasis: z.enum(['value', 'share']).default('value'),
  // An index into bands, not a value, so moving a threshold does not change which band rests.
  restBand: z.number().int().nonnegative().default(0),
  // The standing-fact template. Macros: |name| |nameMid| |defName| |bandLabel| |value|
  line: z.string().max(400).optional(),
  // Purely for grouping on screen.
  category: z.string().max(80).optional(),
  terminals: z.array(stateTerminalSchema).max(24).default([]),
  display: z.enum(STATE_DISPLAYS).default('value'),
  // Four Approaches: the approach that owns this state, and approaches that can move it
  // with a setback die. An approach in neither list cannot move it at all.
  approach: z.object({
    owner: id,
    secondary: z.array(id).max(8).default([]),
  }).optional(),
  // A check builds this up instead of wearing it down (Focus's Leverage and Prepared).
  grows: z.boolean().default(false),
  // Held by a check's target, each point helps a check against that target by another
  // approach, and is spent there: 'easier' lowers the difficulty a step, 'boost' adds a
  // boost die.
  aids: z.enum(['easier', 'boost']).optional(),
  // What acting on it is, in a few words, for the check screen: "Hurt or overpower".
  verb: z.string().max(80).optional(),
});

export type StateBand = z.infer<typeof stateBandSchema>;
export type StateTerminal = z.infer<typeof stateTerminalSchema>;
export type StateDef = z.infer<typeof stateDefSchema>;

// Stored values: owner key, then definition id. The world's values live under WORLD_OWNER.
export type StateValues = Readonly<Record<string, Readonly<Record<string, number>>>>;
export const WORLD_OWNER = 'world';

// The one place a relationship's key is built. Unordered by construction, so a pair cannot
// end up with two records.
export function pairKey(a: string, b: string): string {
  if (!a || !b || a === b) throw new Error('A relationship needs two different characters.');
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export const DEFAULT_STATE_LINE = '[|name| |bandLabel|.]';

// Who changed a value. 'rule' is a resolved action; 'player' is an override.
export type ChangeSource = 'rule' | 'player';

export interface StateChange {
  defId: string;
  owner: string;
  from: number;
  to: number;
  source: ChangeSource;
}

export interface StateWrite {
  values: StateValues;
  // null when the value did not move.
  change: StateChange | null;
  // The terminal this write arrived at, or null.
  terminal: StateTerminal | null;
}

export function bounds(def: StateDef): { lo: number; hi: number } {
  return def.min <= def.max ? { lo: def.min, hi: def.max } : { lo: def.max, hi: def.min };
}

export function clamp(def: StateDef, value: number): number {
  const { lo, hi } = bounds(def);
  const n = Number.isFinite(value) ? Math.round(value) : Math.round(def.start);
  return Math.max(lo, Math.min(hi, n));
}

export function startOf(def: StateDef): number {
  return clamp(def, def.start);
}

// The definition as it applies to one owner: their own maximum, if they have one, replaces the
// catalog's, and the start is clamped under it. Every read and write for that owner goes
// through this, so a tier's limits hold everywhere.
export function forOwner(def: StateDef, maximum: number | undefined): StateDef {
  if (maximum === undefined || maximum === def.max) return def;
  return { ...def, max: maximum };
}

export function appliesTo(def: StateDef, kind: OwnerKind, isProtagonist = false): boolean {
  switch (def.scope) {
    case 'world': return kind === 'world';
    case 'char': return kind === 'character';
    case 'protagonist': return kind === 'character' && isProtagonist;
    case 'npc': return kind === 'character' && !isProtagonist;
    case 'place': return kind === 'place';
    case 'item': return kind === 'item';
    case 'faction': return kind === 'faction';
    case 'relationship': return kind === 'relationship';
    case 'event': return kind === 'event';
  }
}

export function read(values: StateValues, def: StateDef, owner: string): number {
  const stored = values[owner]?.[def.id];
  return stored === undefined ? startOf(def) : clamp(def, stored);
}

export interface BandReading {
  // -1 when the definition has no bands.
  index: number;
  label: string;
  atRest: boolean;
  banded: boolean;
}

export function band(def: StateDef, value: number): BandReading {
  if (!def.bands.length) return { index: -1, label: '', atRest: true, banded: false };
  const v = clamp(def, value);
  const { lo, hi } = bounds(def);
  const measure = def.bandBasis === 'share' ? (hi === lo ? 100 : ((v - lo) / (hi - lo)) * 100) : v;
  let index = 0;
  def.bands.forEach((b, i) => { if (i === 0 || measure >= b.at) index = i; });
  const rest = Math.max(0, Math.min(def.bands.length - 1, def.restBand));
  return { index, label: def.bands[index]?.label ?? '', atRest: index === rest, banded: true };
}

// A value reaches context only if its definition has bands and it is off its resting band.
export function speaks(def: StateDef, value: number): boolean {
  const b = band(def, value);
  return b.banded && !b.atRest;
}

export function terminalIndexOf(def: StateDef, value: number): number {
  if (!def.terminals.length) return -1;
  const { lo, hi } = bounds(def);
  const v = clamp(def, value);
  const bandIndex = band(def, v).index;
  for (let i = 0; i < def.terminals.length; i++) {
    const t = def.terminals[i];
    if (!t) continue;
    if (t.at === 'band') {
      if (t.band !== undefined && bandIndex >= 0 && t.band === bandIndex) return i;
      continue;
    }
    if (t.at === 'min' && v <= lo) return i;
    if (t.at === 'max' && v >= hi) return i;
  }
  return -1;
}

export function write(values: StateValues, def: StateDef, owner: string, next: number, source: ChangeSource = 'rule'): StateWrite {
  if (!owner) throw new Error(`State ${def.id} needs an owner.`);
  const from = read(values, def, owner);
  const to = clamp(def, next);
  if (to === from) return { values, change: null, terminal: null };
  const updated: StateValues = { ...values, [owner]: { ...(values[owner] ?? {}), [def.id]: to } };
  const before = terminalIndexOf(def, from);
  const after = terminalIndexOf(def, to);
  const terminal = after >= 0 && after !== before ? def.terminals[after] ?? null : null;
  return { values: updated, change: { defId: def.id, owner, from, to, source }, terminal };
}

// A delta, read inside the same call, so two nudges in one turn both land.
export function nudge(values: StateValues, def: StateDef, owner: string, delta: number, source: ChangeSource = 'rule'): StateWrite {
  if (!Number.isFinite(delta) || Math.round(delta) === 0) return { values, change: null, terminal: null };
  return write(values, def, owner, read(values, def, owner) + Math.round(delta), source);
}

// The standing fact one definition writes for one owner, or '' when it is silent.
// The only place a state becomes words for the model.
export function line(def: StateDef, ownerName: string, value: number): string {
  if (!speaks(def, value)) return '';
  return render(def, ownerName, value);
}

// The same sentence whether or not it would reach the model, for the player's own screens.
export function render(def: StateDef, ownerName: string, value: number): string {
  const b = band(def, value);
  const template = def.line?.trim() || DEFAULT_STATE_LINE;
  const macros: Record<string, string> = {
    name: ownerName,
    // The name as it reads inside a sentence: "The harbour" becomes "the harbour".
    nameMid: ownerName.replace(/^(The|A|An) /, (word) => word.toLowerCase()),
    defName: def.name,
    bandLabel: b.label,
    value: String(clamp(def, value)),
  };
  return template.replace(/\|(name|nameMid|defName|bandLabel|value)\|/g, (_, key: string) => macros[key] ?? '').replace(/\s+/g, ' ').trim();
}
