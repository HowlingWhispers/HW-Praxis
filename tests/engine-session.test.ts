import { describe, expect, it } from 'vitest';
import { band, placeCharacter, read, sceneOf, setClock, setState, startSave, stateDefFor, travel, wait, type Save } from '../src/engine';
import { abernys } from './abernys';

const module = abernys();
const health = module.ruleset.states.find((state) => state.id === 'health')!;

function ok(result: ReturnType<typeof travel>): Save {
  if (!result.ok) throw new Error(result.reason);
  return result.save;
}

describe('a fresh save', () => {
  const save = startSave(module);

  it('starts at the scenario\'s place and time with its cast present', () => {
    const scene = sceneOf(module, save);
    expect(scene.place.id).toBe('pc-landward-gate');
    expect(scene.stamp).toBe('Sunday 07:40');
    expect(scene.timeBand).toBe('early morning');
    expect(scene.present.map((character) => character.id)).toEqual(['gate-arbiter', 'gate-guard']);
  });

  it('puts everyone else at home', () => {
    expect(save.positions['lucan-abreu']).toBe('pc-registry');
    expect(save.positions.cadfan).toBe('bogwater');
  });

  it('stores only starting values that differ from a state\'s own start', () => {
    expect(read(save.values, stateDefFor(module, 'force', 'traveller')!, 'traveller')).toBe(2);
    expect(read(save.values, health, 'traveller')).toBe(8);
    expect(save.values.traveller?.health).toBeUndefined();
  });

  it('gives a tiered character their own maximum, read as a share for bands', () => {
    const guardHealth = stateDefFor(module, 'health', 'gate-guard')!;
    expect(read(save.values, guardHealth, 'gate-guard')).toBe(2);
    expect(band(guardHealth, 2).label).toBe('is unhurt');
    expect(band(guardHealth, 1).label).toBe('is hurt');
    expect(band(health, 1).label).toBe('is badly hurt');
  });
});

describe('travel', () => {
  it('moves the player, passes time and records both', () => {
    const save = ok(travel(module, startSave(module), 'pc-outside-walls'));
    expect(sceneOf(module, save).place.id).toBe('pc-outside-walls');
    expect(save.clock).toBe(460 + 8);
    expect(save.ledger.map((entry) => entry.kind)).toEqual(['clock', 'move']);
    expect(sceneOf(module, save).present).toEqual([]);
  });

  it('changes nothing when refused', () => {
    const before = startSave(module);
    const result = travel(module, before, 'pc-harbour');
    expect(result).toEqual({ ok: false, reason: 'No one enters the port without signing the Covenant.' });
  });

  it('meets the people who live where it ends', () => {
    let save = ok(setState(module, startSave(module), 'signed-covenant', 'traveller', 1));
    save = ok(travel(module, save, 'pc-registry'));
    expect(sceneOf(module, save).present.map((character) => character.id)).toEqual(['lucan-abreu']);
  });
});

describe('waiting', () => {
  it('passes time in place', () => {
    const save = ok(wait(startSave(module), 60));
    expect(sceneOf(module, save).stamp).toBe('Sunday 08:40');
    expect(wait(save, 0)).toEqual({ ok: false, reason: 'Waiting takes a positive number of minutes.' });
  });
});

describe('overrides', () => {
  it('set a state by hand and record it as the player\'s edit', () => {
    const result = setState(module, startSave(module), 'health', 'traveller', 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries[0]).toMatchObject({ kind: 'state', defId: 'health', from: 8, to: 0, source: 'player' });
    expect(result.terminals[0]?.note).toMatch(/take no further part in this scene/);
  });

  it('hold to the owner\'s own maximum', () => {
    const result = setState(module, startSave(module), 'health', 'gate-guard', 9);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries).toEqual([]);
  });

  it('refuse a state that does not apply to its owner', () => {
    expect(setState(module, startSave(module), 'signed-covenant', 'gate-guard', 1).ok).toBe(false);
    expect(setState(module, startSave(module), 'alert', 'pc-landward-gate', 2).ok).toBe(true);
    expect(setState(module, startSave(module), 'health', 'nobody', 2).ok).toBe(false);
  });

  it('set the clock', () => {
    const save = ok(setClock(module, startSave(module), 20 * 60));
    expect(sceneOf(module, save).timeBand).toBe('the evening');
    expect(save.ledger[0]).toMatchObject({ kind: 'clock', source: 'player' });
  });

  it('move anyone without travel or time, but never into an area', () => {
    const start = startSave(module);
    const save = ok(placeCharacter(module, start, 'traveller', 'caerwyn'));
    expect(save.clock).toBe(start.clock);
    expect(sceneOf(module, save).place.id).toBe('caerwyn');
    expect(placeCharacter(module, start, 'traveller', 'fenmire').ok).toBe(false);
    expect(placeCharacter(module, start, 'traveller', null).ok).toBe(false);
    const gone = ok(placeCharacter(module, start, 'gate-guard', null));
    expect(sceneOf(module, gone).present.map((character) => character.id)).toEqual(['gate-arbiter']);
  });
});
