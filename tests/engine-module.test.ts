import { describe, expect, it } from 'vitest';
import { loadModule } from '../src/engine';
import { sampleModule } from './fixtures/sample-module';

function errorsFor(change: (module: Record<string, any>) => void): string[] {
  const module = sampleModule() as Record<string, any>;
  change(module);
  const result = loadModule(module);
  return result.ok ? [] : result.errors;
}

describe('module loading', () => {
  it('loads a valid module and fills defaults', () => {
    const result = loadModule(sampleModule());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.module.scenario.startAt).toBe(480);
    expect(result.module.world.factions).toEqual([]);
    expect(result.module.ruleset.states).toHaveLength(2);
  });

  it('keeps Orbis fields the schema does not name', () => {
    const result = loadModule(sampleModule());
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.module.world.places[1]).toMatchObject({ terrain: 'shingle' });
  });

  it('rejects another format', () => {
    expect(errorsFor((m) => { m.format = 'orbis-authoring/1'; })[0]).toMatch(/^format/);
  });

  it('reports broken references with their location', () => {
    expect(errorsFor((m) => { m.world.places[2].parentLocationId = 'nowhere'; }))
      .toContain('world.places.2.parentLocationId: Unknown parent place "nowhere".');
    expect(errorsFor((m) => { m.scenario.startPlaceId = 'nowhere'; }))
      .toContain('scenario.startPlaceId: Unknown place "nowhere".');
    expect(errorsFor((m) => { m.scenario.playerCharacterId = 'nobody'; }))
      .toContain('scenario.playerCharacterId: Unknown character "nobody".');
    expect(errorsFor((m) => { m.scenario.presentCharacterIds = ['nobody']; }))
      .toContain('scenario.presentCharacterIds.0: Unknown character "nobody".');
  });

  it('rejects a place that contains itself', () => {
    const errors = errorsFor((m) => { m.world.places[0].parentLocationId = 'yard'; });
    expect(errors.some((entry) => entry.includes('is inside itself'))).toBe(true);
  });

  it('rejects duplicate ids', () => {
    expect(errorsFor((m) => { m.characters[1].id = 'vess'; }))
      .toContain('characters.1.id: Duplicate id "vess".');
  });

  it('rejects a resting band that does not exist', () => {
    expect(errorsFor((m) => { m.ruleset.states[0].restBand = 7; }))
      .toContain('ruleset.states.0.restBand: Resting band 7 does not exist.');
  });
});
