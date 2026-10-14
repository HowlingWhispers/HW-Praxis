// A small test module. Illustrative places and people, not canon.
export const healthDef = {
  id: 'health',
  name: 'Health',
  scope: 'char',
  min: 0,
  max: 8,
  start: 8,
  bands: [
    { at: 0, label: 'is down' },
    { at: 1, label: 'is badly hurt' },
    { at: 3, label: 'is hurt' },
    { at: 5, label: 'is bruised' },
    { at: 7, label: 'is unhurt' },
  ],
  restBand: 4,
  terminals: [{ at: 'min', note: 'They go down and do not get up this scene.' }],
  display: 'band',
  approach: { owner: 'force', secondary: [] },
} as const;

export const alertDef = {
  id: 'alert',
  name: 'Alert',
  scope: 'place',
  min: 0,
  max: 3,
  start: 0,
  bands: [
    { at: 0, label: 'is quiet' },
    { at: 1, label: 'is uneasy' },
    { at: 2, label: 'is watchful' },
    { at: 3, label: 'is roused' },
  ],
  restBand: 0,
  terminals: [
    { at: 'band', band: 2, note: 'Someone is looking for the cause of the noise.' },
    { at: 'band', band: 3, note: 'The scene is roused: everyone present is hunting.' },
  ],
  approach: { owner: 'finesse', secondary: [] },
} as const;

export function sampleModule(): Record<string, unknown> {
  return {
    format: 'praxis-module/1',
    id: 'sample',
    name: 'Sample module',
    version: '0.1.0',
    source: { kind: 'local' },
    world: {
      id: 'world-sample',
      name: 'Sample coast',
      places: [
        { id: 'coast', name: 'The coast', kind: 'region', parentLocationId: null },
        { id: 'harbour', name: 'Harbour town', kind: 'town', parentLocationId: 'coast', terrain: 'shingle' },
        { id: 'yard', name: 'The factor\'s yard', kind: 'building', parentLocationId: 'harbour' },
      ],
      species: [{ id: 'foxfolk', name: 'Foxfolk' }],
    },
    characters: [
      { id: 'vess', name: 'Vess', speciesId: 'foxfolk' },
      { id: 'guard', name: 'The yard guard' },
    ],
    ruleset: { states: [healthDef, alertDef] },
    scenario: {
      title: 'Night at the yard',
      startPlaceId: 'yard',
      playerCharacterId: 'vess',
      presentCharacterIds: ['guard'],
    },
  };
}
