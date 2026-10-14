import { describe, expect, it } from 'vitest';
import { atlasOf, destinationsFrom, exitsFrom, findPath, loadModule, type StateValues } from '../src/engine';
import { abernys, abernysRaw } from './abernys';

const module = abernys();
const player = 'traveller';
const unsigned: StateValues = {};
const signed: StateValues = { traveller: { 'signed-covenant': 1 } };

describe('the Abernys module', () => {
  it('loads without errors', () => {
    const result = loadModule(abernysRaw);
    expect(result.ok ? [] : result.errors).toEqual([]);
  });
});

describe('the atlas', () => {
  it('measures depth from the island', () => {
    const { depth } = atlasOf(module);
    expect(depth.get('abernys')).toBe(0);
    expect(depth.get('port-covenant')).toBe(2);
    expect(depth.get('pc-harbour')).toBe(3);
  });

  it('prices hops inside a place by tier and routes by distance', () => {
    const fromTown = exitsFrom(module, signed, player, 'port-covenant');
    expect(fromTown.find((exit) => exit.place.id === 'pc-harbour')?.edge.minutes).toBe(10);
    const fromGate = exitsFrom(module, signed, player, 'pc-landward-gate');
    // 64 km at 4 km/h.
    expect(fromGate.find((exit) => exit.place.id === 'caerwyn')?.edge.minutes).toBe(960);
  });

  it('never walks through an area', () => {
    const fromGate = exitsFrom(module, signed, player, 'pc-landward-gate').map((exit) => exit.place.id);
    expect(fromGate).not.toContain('nospier-point');
    const result = findPath(module, signed, player, 'pc-landward-gate', 'fenmire');
    expect(result.ok).toBe(false);
  });
});

describe('gated routes', () => {
  it('keep an unsigned player out of the port, with the route\'s own reason', () => {
    const result = findPath(module, unsigned, player, 'pc-landward-gate', 'pc-harbour');
    expect(result).toEqual({ ok: false, reason: 'No one enters the port without signing the Covenant.' });
  });

  it('let a signed player in by the quickest way', () => {
    const result = findPath(module, signed, player, 'pc-landward-gate', 'pc-harbour');
    expect(result.ok && result.minutes).toBe(13);
    expect(result.ok && result.steps.map((step) => step.to)).toEqual(['port-covenant', 'pc-harbour']);
  });

  it('only apply toward the place they guard', () => {
    const result = findPath(module, unsigned, player, 'pc-harbour', 'pc-landward-gate');
    expect(result.ok).toBe(true);
  });

  it('show up on the exit list', () => {
    const gate = exitsFrom(module, unsigned, player, 'pc-landward-gate').find((exit) => exit.place.id === 'port-covenant');
    expect(gate?.blocked).toBe('No one enters the port without signing the Covenant.');
  });
});

describe('journeys', () => {
  it('take the quickest open way across routes', () => {
    const result = findPath(module, signed, player, 'pc-harbour', 'bogwater');
    // Harbour to town 10, town to gate 3, gate to Bogwater 330.
    expect(result.ok && result.minutes).toBe(343);
  });

  it('list every destination except areas and the current place', () => {
    const ids = destinationsFrom(module, signed, player, 'pc-landward-gate').map((entry) => entry.place.id);
    expect(ids).toContain('caerwyn');
    expect(ids).not.toContain('pc-landward-gate');
    expect(ids).not.toContain('abernys');
  });

  it('explain a destination with no way to it', () => {
    const island = loadModule({
      format: 'praxis-module/1', id: 'x', name: 'x', version: '1', source: { kind: 'local' },
      world: { id: 'w', name: 'w', places: [{ id: 'a', name: 'A', kind: 'town' }, { id: 'b', name: 'B', kind: 'town' }] },
      characters: [{ id: 'p', name: 'P' }],
      scenario: { title: 't', startPlaceId: 'a', playerCharacterId: 'p' },
    });
    if (!island.ok) throw new Error(island.errors.join('\n'));
    expect(findPath(island.module, {}, 'p', 'a', 'b')).toEqual({ ok: false, reason: 'There is no known way from here to B.' });
  });
});
