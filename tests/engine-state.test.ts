import { describe, expect, it } from 'vitest';
import {
  appliesTo, band, clamp, line, nudge, pairKey, read, speaks, stateDefSchema, terminalIndexOf, write,
  type StateValues,
} from '../src/engine';
import { alertDef, healthDef } from './fixtures/sample-module';

const health = stateDefSchema.parse(healthDef);
const alert = stateDefSchema.parse(alertDef);
const empty: StateValues = {};

describe('reading', () => {
  it('falls back to the start value and writes nothing', () => {
    expect(read(empty, health, 'vess')).toBe(8);
    expect(empty).toEqual({});
  });

  it('clamps stored values that are out of bounds on read', () => {
    expect(read({ vess: { health: 99 } }, health, 'vess')).toBe(8);
  });

  it('treats reversed bounds as the same range', () => {
    const reversed = stateDefSchema.parse({ ...healthDef, min: 8, max: 0 });
    expect(clamp(reversed, -3)).toBe(0);
    expect(clamp(reversed, 12)).toBe(8);
  });
});

describe('bands', () => {
  it('finds the band and the resting band by index', () => {
    expect(band(health, 8)).toMatchObject({ index: 4, label: 'is unhurt', atRest: true });
    expect(band(health, 6)).toMatchObject({ index: 3, label: 'is bruised', atRest: false });
    expect(band(health, 0)).toMatchObject({ index: 0, label: 'is down' });
  });

  it('keeps unbanded states out of context entirely', () => {
    const rating = stateDefSchema.parse({ id: 'force', name: 'Force', scope: 'char', min: 1, max: 4, start: 1 });
    expect(band(rating, 3).banded).toBe(false);
    expect(speaks(rating, 3)).toBe(false);
    expect(line(rating, 'Vess', 3)).toBe('');
  });

  it('writes a standing fact only off the resting band', () => {
    expect(line(health, 'Vess', 8)).toBe('');
    expect(line(health, 'Vess', 5)).toBe('[Vess is bruised.]');
    const custom = stateDefSchema.parse({ ...healthDef, line: '|name|: |defName| |value|, |bandLabel|' });
    expect(line(custom, 'Vess', 2)).toBe('Vess: Health 2, is badly hurt');
  });
});

describe('writing', () => {
  it('clamps at the write and records the change', () => {
    const result = nudge(empty, health, 'vess', -20);
    expect(read(result.values, health, 'vess')).toBe(0);
    expect(result.change).toEqual({ defId: 'health', owner: 'vess', from: 8, to: 0, source: 'rule' });
  });

  it('does not mutate the values it was given', () => {
    const before: StateValues = { vess: { health: 6 } };
    write(before, health, 'vess', 2);
    expect(before).toEqual({ vess: { health: 6 } });
  });

  it('reads inside each nudge so two nudges in one turn both land', () => {
    const once = nudge(empty, health, 'vess', -2);
    const twice = nudge(once.values, health, 'vess', -2);
    expect(read(twice.values, health, 'vess')).toBe(4);
  });

  it('reports no change when nothing moved', () => {
    expect(nudge(empty, health, 'vess', 0).change).toBeNull();
    expect(write(empty, health, 'vess', 8).change).toBeNull();
    expect(nudge(empty, health, 'vess', 5).change).toBeNull();
  });

  it('records a player override as the player\'s edit', () => {
    expect(write(empty, health, 'vess', 3, 'player').change?.source).toBe('player');
  });
});

describe('terminals', () => {
  it('fire on arriving at a bound', () => {
    const atOne = write(empty, health, 'vess', 1).values;
    const down = nudge(atOne, health, 'vess', -1);
    expect(down.terminal?.note).toMatch(/go down/);
  });

  it('do not fire again while the value stays there', () => {
    const down = write(empty, health, 'vess', 0).values;
    expect(nudge(down, health, 'vess', -1).terminal).toBeNull();
  });

  it('fire when stepping from one band terminal straight into another', () => {
    const watchful = write(empty, alert, 'yard', 2);
    expect(watchful.terminal?.note).toMatch(/looking for the cause/);
    const roused = nudge(watchful.values, alert, 'yard', 1);
    expect(roused.terminal?.note).toMatch(/roused/);
  });

  it('ignore a band index past the end', () => {
    const loose = stateDefSchema.parse({ ...alertDef, terminals: [{ at: 'band', band: 9, note: 'Never.' }] });
    expect(terminalIndexOf(loose, 3)).toBe(-1);
  });
});

describe('ownership', () => {
  it('keys a relationship the same way from either side', () => {
    expect(pairKey('vess', 'guard')).toBe(pairKey('guard', 'vess'));
    expect(() => pairKey('vess', 'vess')).toThrow();
  });

  it('splits characters into protagonist and npc scopes', () => {
    const edge = stateDefSchema.parse({ id: 'edge', name: 'Edge', scope: 'protagonist', min: 0, max: 1, start: 0 });
    const resolve = stateDefSchema.parse({ id: 'resolve', name: 'Resolve', scope: 'npc', min: 0, max: 3, start: 3 });
    expect(appliesTo(edge, 'character', true)).toBe(true);
    expect(appliesTo(edge, 'character', false)).toBe(false);
    expect(appliesTo(resolve, 'character', false)).toBe(true);
    expect(appliesTo(health, 'place')).toBe(false);
  });
});
