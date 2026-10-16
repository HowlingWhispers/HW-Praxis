// Pieces several screens share: how a state, a ledger line or a record is shown.
import {
  band, durationWords, inSentence, pairName, read, render, stateDefFor, type Character, type LedgerEntry, type PraxisModule, type StateDef, type StateValues,
} from '../engine';
import { Diamond } from './icons';

export const APPROACH_COLORS: Record<string, string> = {
  force: 'var(--force)', finesse: 'var(--finesse)', focus: 'var(--focus)', flair: 'var(--flair)',
};
const RAW_COLORS: Record<string, string> = { force: '#e0876b', finesse: '#75d9df', focus: '#a99bf0', flair: '#d9b46d' };

// A state's colour: its own if it is an approach, else the approach that owns it, else none.
export function stateColor(def: StateDef): string {
  return APPROACH_COLORS[def.id] ?? (def.approach ? APPROACH_COLORS[def.approach.owner] : undefined) ?? 'var(--text-2)';
}

export function initials(name: string): string {
  const words = name.replace(/^(The|A|An) /, '').split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0]!.charAt(0).toUpperCase() + words[0]!.slice(1, 2);
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

// Records keep fields this app does not name (Orbis documents are free-form), so these read
// them loosely.
const field = (record: object | null | undefined, key: string): unknown => (record ? (record as Record<string, unknown>)[key] : undefined);

export function isDraft(record: object | null | undefined): boolean {
  return field(record, 'canonStatus') === 'draft';
}

export function DraftTag({ record, show }: { record: object | null | undefined; show: boolean }) {
  return show && isDraft(record) ? <span className="tag draft">Draft</span> : null;
}

export function isLocalRecord(record: object | null | undefined): boolean {
  return field(record, 'origin') === 'local';
}

export function YoursTag({ record }: { record: object | null | undefined }) {
  return isLocalRecord(record) ? <span className="tag yours">Yours</span> : null;
}

// "has not signed the Covenant" said of "you".
export function bandForYou(label: string): string {
  return label.replace(/^has /, 'have ').replace(/^is /, 'are ').replace(/^was /, 'were ');
}

// A bounded value as a row of segments, or one bar when the range is long.
export function StateBar({ def, value }: { def: StateDef; value: number }) {
  const lo = Math.min(def.min, def.max);
  const hi = Math.max(def.min, def.max);
  const span = hi - lo;
  const color = stateColor(def);
  if (span > 0 && span <= 12) {
    return (
      <span className="bar" aria-hidden="true">
        {Array.from({ length: span }, (_, index) => <span key={index} style={index < value - lo ? { background: color } : undefined} />)}
      </span>
    );
  }
  const share = span > 0 ? Math.max(0, Math.min(1, (value - lo) / span)) : 0;
  return (
    <span className="bar continuous" aria-hidden="true">
      <span style={{ background: `linear-gradient(90deg, ${color} ${share * 100}%, #2a303c ${share * 100}%)` }} />
    </span>
  );
}

export function Pips({ def, value }: { def: StateDef; value: number }) {
  const max = Math.max(def.min, def.max);
  const color = RAW_COLORS[def.id] ?? '#b7bcc6';
  return (
    <span className="pips" role="img" aria-label={`${def.name} ${value} of ${max}`}>
      {Array.from({ length: max }, (_, index) => <Diamond key={index} color={color} filled={index < value} />)}
    </span>
  );
}

export interface StateReading {
  def: StateDef;
  value: number;
  word: string;
  atRest: boolean;
}

export function readState(module: PraxisModule, values: StateValues, defId: string, owner: string): StateReading | null {
  const def = stateDefFor(module, defId, owner);
  if (!def) return null;
  const value = read(values, def, owner);
  const reading = band(def, value);
  return { def, value, word: reading.banded ? reading.label : String(value), atRest: reading.atRest };
}

// The states one character holds that a player would look at, in catalog order.
export function characterStates(module: PraxisModule, character: Character, isPlayer: boolean): StateDef[] {
  return module.ruleset.states
    .filter((def) => def.display !== 'hidden')
    .filter((def) => def.scope === 'char' || (def.scope === 'protagonist' && isPlayer) || (def.scope === 'npc' && !isPlayer))
    .map((def) => stateDefFor(module, def.id, character.id) ?? def);
}

export function SourceTag({ source }: { source: 'rule' | 'player' }) {
  return source === 'player' ? <span className="src you">Yours</span> : <span className="src">Rule</span>;
}

// One ledger line in the player's words. The player's own character is "You".
export function describeEntry(module: PraxisModule, entry: LedgerEntry): string {
  const playerId = module.scenario.playerCharacterId;
  const placeName = (id: string | null) => (id === null ? 'nowhere' : module.world.places.find((place) => place.id === id)?.name ?? id);
  const personName = (id: string) => (id === playerId ? 'You' : module.characters.find((character) => character.id === id)?.name
    ?? module.items.find((item) => item.id === id)?.name
    ?? module.world.places.find((place) => place.id === id)?.name
    ?? module.world.factions.find((group) => group.id === id)?.name
    ?? id);
  switch (entry.kind) {
    case 'move':
      if (entry.to === null) return `${personName(entry.characterId)} left the story`;
      return `${personName(entry.characterId)} · ${entry.from === null ? 'arrived at' : `${placeName(entry.from)} to`} ${inSentence(placeName(entry.to))}${entry.minutes ? ` · ${durationWords(entry.minutes)}` : ''}`;
    case 'clock':
      return entry.to >= entry.from ? `${durationWords(entry.to - entry.from)} passed${entry.reason === 'set by hand' ? '' : ` (${entry.reason})`}` : `Clock turned back ${durationWords(entry.from - entry.to)}`;
    case 'state': {
      const def = stateDefFor(module, entry.defId, entry.owner);
      const word = def ? band(def, entry.to) : null;
      if (entry.owner.includes('|')) {
        const pair = pairName(module, entry.owner, playerId);
        return `${pair.charAt(0).toUpperCase()}${pair.slice(1)}${word?.banded ? `: ${word.label}` : ` · ${def?.name ?? entry.defId}`} · ${entry.from} → ${entry.to}`;
      }
      const who = personName(entry.owner);
      // A state with its own sentence ("You have studied the door.") reads best as that.
      if (def?.line && word?.banded) return `${render(def, who, entry.to).replace(/^\[|\]$/g, '')} · ${entry.from} → ${entry.to}`;
      if (word?.banded) return `${who} ${entry.owner === playerId ? bandForYou(word.label) : word.label} · ${entry.from} → ${entry.to}`;
      return `${who} · ${def?.name ?? entry.defId} ${entry.from} → ${entry.to}`;
    }
  }
}

export function speciesOf(module: PraxisModule, character: Character): string {
  return character.speciesId ? module.world.species.find((species) => species.id === character.speciesId)?.name ?? '' : '';
}

export function groupsOf(module: PraxisModule, character: Character): string[] {
  const groups = [...module.world.factions, ...module.world.societies];
  return character.factionIds.map((id) => groups.find((group) => group.id === id)?.name).filter((name): name is string => Boolean(name));
}

export function roleOf(character: Character): string {
  return typeof character.role === 'string' ? character.role : '';
}

export function newId(prefix: string): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}
