// The standard ruleset: the Four Approaches on Genesys dice, as a module would write it.
//
// A module that sets `ruleset.extends: "four-approaches/1"` gets everything here beneath its
// own rules: its own states, approaches and deeds win by id, and anything it leaves out
// comes from here. So a world with no rules of its own is still playable, and every person,
// thing and place offers the four approaches without an author building a single obstacle.

export const STANDARD_RULESET_ID = 'four-approaches/1';

const share = (labels: [number, string][]) => labels.map(([at, label]) => ({ at, label }));

export const STANDARD_RULESET = {
  states: [
    ...(['force', 'finesse', 'focus', 'flair'] as const).map((id) => ({
      id, name: id.charAt(0).toUpperCase() + id.slice(1), scope: 'char', min: 1, max: 4, start: 1, category: 'Approaches',
    })),
    {
      id: 'health', name: 'Health', scope: 'char', min: 0, max: 8, start: 8, category: 'Condition', display: 'band', bandBasis: 'share',
      // "Words: what they mean". The screen shows the words; the narrator reads both, so a
      // wound that is not yet the end says so. Any loss leaves the resting band, so a
      // success always shows.
      bands: share([[0, 'is down'], [1, 'is badly hurt: every move costs you'], [34, 'is hurt: it slows you'], [60, 'is bruised'], [100, 'is unhurt']]), restBand: 4,
      npcLabels: [
        'is down: out of the fight and unable to act',
        'is near death: barely standing, and one more good blow could drop them',
        'is hurt: bleeding and slowed, but still fighting',
        'is bruised: shaken, but still fighting',
        'is unhurt',
      ],
      terminals: [{ at: 'min', note: 'They take no further part in this scene.', playerNote: 'You can do nothing more in this scene.' }],
      approach: { owner: 'force', secondary: [] }, verb: 'Hurt or overpower',
    },
    {
      id: 'strain', name: 'Strain', scope: 'char', min: 0, max: 6, start: 6, category: 'Condition', display: 'band', bandBasis: 'share',
      bands: share([[0, 'is spent'], [1, 'is badly strained: your composure is fraying'], [34, 'is strained'], [100, 'is steady']]), restBand: 3,
      // Against someone else, Strain is their will to hold out against you.
      npcLabels: [
        'has given way: they believe you, back down or do as you ask, until something new changes their mind',
        'is close to giving way: still holding out, but not for much longer',
        'is wavering: unsure now, but still holding out',
        'is steady',
      ],
      terminals: [{ at: 'min', note: 'They stay that way unless something new changes their mind.', playerNote: 'You can push yourself no further until you rest.' }],
      approach: { owner: 'flair', secondary: ['force'] }, verb: 'Persuade, charm, bluff or intimidate',
    },
    { id: 'edge', name: 'Edge', scope: 'protagonist', min: 0, max: 1, start: 0, category: 'Momentum' },
    { id: 'story-points', name: 'Story Points', scope: 'protagonist', min: 0, max: 2, start: 1, category: 'Momentum' },
    { id: 'momentum', name: 'Momentum', scope: 'protagonist', min: -3, max: 3, start: 0, category: 'Momentum', display: 'hidden' },
    {
      id: 'alert', name: 'Alert', scope: 'place', min: 0, max: 3, start: 0, category: 'Scene', display: 'band',
      bands: share([[0, 'is quiet'], [1, 'is uneasy: they keep an eye on you'], [2, 'is watching closely: one more slip and they act'], [3, 'is roused: they act against you']]), restBand: 0,
      line: '[Everyone at |nameMid| |bandLabel|.]',
      terminals: [{ at: 'max', note: 'Nothing passes unchallenged now.' }],
      approach: { owner: 'finesse', secondary: [] }, verb: 'Lie low, cover your tracks',
    },
    // Focus builds these up. Each point helps a later check against the same person, thing
    // or place, by another approach, and is spent there.
    {
      id: 'leverage', name: 'Leverage', scope: 'npc', min: 0, max: 2, start: 0, category: 'Focus', display: 'band',
      bands: share([[0, 'nothing'], [1, 'something'], [2, 'real leverage']]), restBand: 0, line: '[You have |bandLabel| on |nameMid|.]',
      approach: { owner: 'focus', secondary: [] }, grows: true, aids: 'easier', verb: 'Read them, find the pressure point',
    },
    {
      id: 'prepared', name: 'Prepared', scope: 'item', min: 0, max: 2, start: 0, category: 'Focus', display: 'band',
      bands: share([[0, 'have not studied'], [1, 'have studied'], [2, 'know every inch of']]), restBand: 0, line: '[You |bandLabel| |nameMid|.]',
      approach: { owner: 'focus', secondary: [] }, grows: true, aids: 'boost', verb: 'Study it, work out how it goes',
    },
    {
      id: 'prepared-place', name: 'Prepared', scope: 'place', min: 0, max: 2, start: 0, category: 'Focus', display: 'band',
      bands: share([[0, 'have not studied'], [1, 'have looked over'], [2, 'know every inch of']]), restBand: 0, line: '[You |bandLabel| |nameMid|.]',
      approach: { owner: 'focus', secondary: [] }, grows: true, aids: 'boost', verb: 'Search it, learn its ways',
    },
    // Obstacles: any thing in a scene can be broken or worked open.
    {
      id: 'integrity', name: 'Integrity', scope: 'item', min: 0, max: 2, start: 2, category: 'Obstacle', display: 'band',
      bands: share([[0, 'is broken'], [1, 'is damaged: still holding, but it will not take much more'], [100, 'is sound']]), restBand: 2, bandBasis: 'share',
      terminals: [{ at: 'min', note: 'It gives way, and whatever it held shut is open now.' }],
      approach: { owner: 'force', secondary: [] }, verb: 'Break it or force it',
    },
    {
      id: 'security', name: 'Security', scope: 'item', min: 0, max: 2, start: 2, category: 'Obstacle', display: 'band',
      bands: share([[0, 'is open'], [1, 'is giving: nearly open'], [100, 'is secure']]), restBand: 2, bandBasis: 'share',
      terminals: [{ at: 'min', note: 'Whatever it kept shut or held fast is yours to take.' }],
      approach: { owner: 'finesse', secondary: [] }, verb: 'Pick it, work it loose, take it',
    },
  ],
  approaches: [
    { id: 'force', name: 'Force', failure: [{ stateId: 'health', who: 'player', add: -1 }, { stateId: 'alert', who: 'place', add: 1 }], threat: [{ stateId: 'alert', who: 'place', add: 1 }] },
    { id: 'finesse', name: 'Finesse', failure: [{ stateId: 'alert', who: 'place', add: 1 }], threat: [{ stateId: 'alert', who: 'place', add: 1 }] },
    { id: 'focus', name: 'Focus', failureMinutes: 30, threatMinutes: 15 },
    { id: 'flair', name: 'Flair', failure: [{ stateId: 'strain', who: 'player', add: -1 }], threat: [{ stateId: 'strain', who: 'player', add: -1 }] },
  ],
  // Acts with no state to wear down: they simply work or fail, and fail at the approach's cost.
  deeds: [
    { kind: 'person', approach: 'finesse', label: 'Lift, slip past or plant something' },
  ],
  // Who comes with you when you travel. The first that holds is the one used.
  follow: [
    { id: 'companion', label: 'Bring along', as: 'travelling with you', anyOf: [{ bond: 'follows' }] },
    { id: 'captive', label: 'Take as your captive', as: 'your captive', anyOf: [{ stateId: 'health', atMost: 0 }] },
    { id: 'won-over', label: 'Have them come with you', as: 'going along with you', anyOf: [{ stateId: 'strain', atMost: 0 }] },
  ],
  dice: {
    difficulty: 2, edge: 'edge', storyPoints: 'story-points', momentum: 'momentum',
    setbacks: [
      { stateId: 'health', who: 'player', atMost: 4, reason: 'You are hurt' },
      { stateId: 'alert', who: 'place', atLeast: 2, approaches: ['finesse'], reason: 'Someone is watching' },
      { stateId: 'alert', who: 'place', atLeast: 3, reason: 'The scene is roused' },
    ],
    push: { stateId: 'strain', add: -2 },
  },
  rest: { minutes: 480, effects: [{ stateId: 'health', add: 1 }, { stateId: 'strain', toMax: true }], resetCharges: true },
  // The Four Approaches tiers: how hard someone is to act against, and their maxima.
  tiers: {
    minion: { difficulty: 1, maxima: { health: 2, strain: 1 } },
    rival: { difficulty: 2, maxima: { health: 5, strain: 4 } },
    nemesis: { difficulty: 3, maxima: { health: 8, strain: 6 } },
  },
};

type Keyed = { id?: string; kind?: string; approach?: string };

// The standard's entries in their own order, each replaced by the module's own where it has
// one, then the module's additions.
function mergeBy<T extends Keyed>(base: readonly T[], own: unknown, key: (entry: T) => string): T[] {
  const mine = Array.isArray(own) ? (own as T[]) : [];
  const byKey = new Map(mine.map((entry) => [key(entry), entry]));
  const known = new Set(base.map(key));
  return [...base.map((entry) => byKey.get(key(entry)) ?? entry), ...mine.filter((entry) => !known.has(key(entry)))];
}

// The module's raw ruleset with the standard one beneath it, when it asks for it.
export function withStandard(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const module = raw as Record<string, unknown>;
  const ruleset = module.ruleset && typeof module.ruleset === 'object' ? (module.ruleset as Record<string, unknown>) : null;
  if (!ruleset || ruleset.extends !== STANDARD_RULESET_ID) return raw;
  const merged: Record<string, unknown> = {
    ...ruleset,
    states: mergeBy(STANDARD_RULESET.states as Keyed[], ruleset.states, (entry) => entry.id ?? ''),
    approaches: mergeBy(STANDARD_RULESET.approaches as Keyed[], ruleset.approaches, (entry) => entry.id ?? ''),
    deeds: mergeBy(STANDARD_RULESET.deeds as Keyed[], ruleset.deeds, (entry) => `${entry.kind}:${entry.approach}`),
    follow: mergeBy(STANDARD_RULESET.follow as Keyed[], ruleset.follow, (entry) => entry.id ?? ''),
    dice: ruleset.dice ?? STANDARD_RULESET.dice,
    rest: ruleset.rest ?? STANDARD_RULESET.rest,
    tiers: ruleset.tiers ?? STANDARD_RULESET.tiers,
  };
  return { ...module, ruleset: merged };
}
