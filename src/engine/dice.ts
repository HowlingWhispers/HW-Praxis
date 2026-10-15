// Genesys dice: the six dice, building a pool, exact odds and reading a roll.
//
// Odds are not simulated. Every face of every die is combined, so each figure is the true
// chance for that pool. Randomness is passed in, so a roll is reproducible in tests.

export const DIE_KINDS = ['ability', 'proficiency', 'boost', 'difficulty', 'challenge', 'setback'] as const;
export type DieKind = typeof DIE_KINDS[number];

// A face as symbols: S success, A advantage, R triumph (also a success), F failure,
// T threat, D despair (also a failure).
export const FACES: Record<DieKind, readonly string[]> = {
  ability: ['', 'S', 'S', 'SS', 'A', 'A', 'SA', 'AA'],
  proficiency: ['', 'S', 'S', 'SS', 'SS', 'A', 'SA', 'SA', 'SA', 'AA', 'AA', 'R'],
  boost: ['', '', 'S', 'SA', 'AA', 'A'],
  difficulty: ['', 'F', 'FF', 'T', 'T', 'T', 'TT', 'FT'],
  challenge: ['', 'F', 'F', 'FF', 'FF', 'T', 'T', 'FT', 'FT', 'TT', 'TT', 'D'],
  setback: ['', '', 'F', 'F', 'T', 'T'],
};

export interface Pool {
  // Yours: ability, proficiency and boost dice.
  good: DieKind[];
  // Against you: difficulty, challenge and setback dice.
  bad: DieKind[];
}

export interface PoolInput {
  rating: number;
  charge: number;
  // Each upgrades one ability die to proficiency, or adds an ability die when none is left.
  upgrades: number;
  boost: number;
  difficulty: number;
  // Each upgrades one difficulty die to challenge, or adds a difficulty die when none is left.
  difficultyUpgrades: number;
  setback: number;
}

function upgrade(dice: DieKind[], from: DieKind, to: DieKind, times: number): DieKind[] {
  const out = [...dice];
  for (let n = 0; n < times; n += 1) {
    const index = out.indexOf(from);
    if (index >= 0) out[index] = to;
    else out.push(from);
  }
  return out;
}

// The higher of rating and charge is how many dice; the lower is how many are upgraded.
// Genesys's own rule, with a charge in the skill's place.
export function buildPool(input: PoolInput): Pool {
  const rating = Math.max(0, Math.round(input.rating));
  const charge = Math.max(0, Math.round(input.charge));
  const count = Math.max(rating, charge);
  const upgraded = Math.min(rating, charge);
  let good: DieKind[] = [...Array<DieKind>(upgraded).fill('proficiency'), ...Array<DieKind>(count - upgraded).fill('ability')];
  good = upgrade(good, 'ability', 'proficiency', Math.max(0, input.upgrades));
  good.push(...Array<DieKind>(Math.max(0, input.boost)).fill('boost'));
  let bad: DieKind[] = Array<DieKind>(Math.max(0, input.difficulty)).fill('difficulty');
  bad = upgrade(bad, 'difficulty', 'challenge', Math.max(0, input.difficultyUpgrades));
  bad.push(...Array<DieKind>(Math.max(0, input.setback)).fill('setback'));
  const order = (kinds: readonly DieKind[]) => (a: DieKind, b: DieKind) => kinds.indexOf(a) - kinds.indexOf(b);
  return { good: good.sort(order(['proficiency', 'ability', 'boost'])), bad: bad.sort(order(['challenge', 'difficulty', 'setback'])) };
}

export interface Tally {
  success: number;
  advantage: number;
  triumph: number;
  failure: number;
  threat: number;
  despair: number;
}

export interface Reading {
  tally: Tally;
  netSuccess: number;
  // Positive is advantage, negative is threat.
  netAdvantage: number;
  succeeded: boolean;
  triumph: boolean;
  despair: boolean;
}

export function tallyFaces(faces: readonly string[]): Tally {
  const all = faces.join('');
  const count = (symbol: string) => all.split(symbol).length - 1;
  const triumph = count('R');
  const despair = count('D');
  return { success: count('S') + triumph, advantage: count('A'), triumph, failure: count('F') + despair, threat: count('T'), despair };
}

export function readRoll(tally: Tally): Reading {
  const netSuccess = tally.success - tally.failure;
  return {
    tally,
    netSuccess,
    netAdvantage: tally.advantage - tally.threat,
    succeeded: netSuccess >= 1,
    triumph: tally.triumph > 0,
    despair: tally.despair > 0,
  };
}

export interface Roll {
  good: { kind: DieKind; face: string }[];
  bad: { kind: DieKind; face: string }[];
  reading: Reading;
}

// `random` returns a number in [0, 1), like Math.random.
export function rollPool(pool: Pool, random: () => number): Roll {
  const throwDie = (kind: DieKind) => {
    const faces = FACES[kind];
    const index = Math.min(faces.length - 1, Math.floor(random() * faces.length));
    return { kind, face: faces[index]! };
  };
  const good = pool.good.map(throwDie);
  const bad = pool.bad.map(throwDie);
  return { good, bad, reading: readRoll(tallyFaces([...good, ...bad].map((die) => die.face))) };
}

export interface Odds {
  success: number;
  // At least one success beyond the first.
  extra: number;
  // Two or more net advantage, which gives Edge.
  advantage2: number;
  // Two or more net threat, which triggers the approach's threat cost.
  threat2: number;
  triumph: number;
  despair: number;
}

// Exact chances for a pool, as fractions from 0 to 1.
export function oddsOf(pool: Pool): Odds {
  // Keyed by the tally, as "s,a,r,f,t,d".
  let states = new Map<string, number>([['0,0,0,0,0,0', 1]]);
  for (const kind of [...pool.good, ...pool.bad]) {
    const faces = FACES[kind];
    const next = new Map<string, number>();
    for (const [key, chance] of states) {
      const base = key.split(',').map(Number);
      for (const face of faces) {
        const add = tallyFaces([face]);
        const sum = [base[0]! + add.success, base[1]! + add.advantage, base[2]! + add.triumph, base[3]! + add.failure, base[4]! + add.threat, base[5]! + add.despair].join(',');
        next.set(sum, (next.get(sum) ?? 0) + chance / faces.length);
      }
    }
    states = next;
  }
  const odds: Odds = { success: 0, extra: 0, advantage2: 0, threat2: 0, triumph: 0, despair: 0 };
  for (const [key, chance] of states) {
    const [success, advantage, triumph, failure, threat, despair] = key.split(',').map(Number) as [number, number, number, number, number, number];
    const reading = readRoll({ success, advantage, triumph, failure, threat, despair });
    if (reading.succeeded) odds.success += chance;
    if (reading.netSuccess >= 2) odds.extra += chance;
    if (reading.netAdvantage >= 2) odds.advantage2 += chance;
    if (reading.netAdvantage <= -2) odds.threat2 += chance;
    if (reading.succeeded && reading.triumph) odds.triumph += chance;
    if (!reading.succeeded && reading.despair) odds.despair += chance;
  }
  return odds;
}
