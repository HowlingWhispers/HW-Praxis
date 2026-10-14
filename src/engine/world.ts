// Places, how they connect, and what it costs to cross between them.
//
// Two kinds of edge, both walkable in either direction:
//   inside  a place and a place directly inside it, priced by the inner place's depth tier
//           (Character Engine's travel tiers). Areas take no part: nobody walks through an
//           island to get from one town to another.
//   route   an authored road between two places, priced by distance at the module's pace.
//
// A journey resolves to its destination in one step. The time is the sum of the hops; the
// intermediate places are never visited, so nothing happens in rooms nobody was watching.

import { DEFAULT_CALENDAR, type Calendar } from './clock';
import { AREA_KINDS, stateDefFor, type Place, type PraxisModule } from './module';
import { read, type StateDef, type StateValues } from './state';

export interface Requirement {
  stateId: string;
  atLeast: number;
  toward?: string;
  reason: string;
}

export interface Edge {
  from: string;
  to: string;
  minutes: number;
  kind: 'inside' | 'route';
  routeId?: string;
  terrain?: string;
  requires: Requirement[];
}

export interface Atlas {
  places: ReadonlyMap<string, Place>;
  depth: ReadonlyMap<string, number>;
  edges: ReadonlyMap<string, readonly Edge[]>;
}

const atlases = new WeakMap<PraxisModule, Atlas>();

export function calendarOf(module: PraxisModule): Calendar {
  return module.ruleset.calendar ?? DEFAULT_CALENDAR;
}

export function isArea(place: Place | undefined): boolean {
  return Boolean(place && AREA_KINDS.includes(place.kind));
}

// Built once per module and reused; a module never changes after loading.
export function atlasOf(module: PraxisModule): Atlas {
  const cached = atlases.get(module);
  if (cached) return cached;

  const places = new Map(module.world.places.map((place) => [place.id, place]));
  const depth = new Map<string, number>();
  const depthOf = (placeId: string): number => {
    const known = depth.get(placeId);
    if (known !== undefined) return known;
    const parent = places.get(placeId)?.parentLocationId ?? null;
    const value = parent !== null && places.has(parent) ? depthOf(parent) + 1 : 0;
    depth.set(placeId, value);
    return value;
  };
  places.forEach((_, placeId) => depthOf(placeId));

  const tierMinutes = new Map(module.ruleset.travel.tiers.map((row) => [row.tier, row.minutes]));
  const edges = new Map<string, Edge[]>();
  const add = (edge: Edge) => {
    const list = edges.get(edge.from) ?? [];
    list.push(edge);
    edges.set(edge.from, list);
  };

  for (const place of places.values()) {
    const parent = place.parentLocationId === null ? undefined : places.get(place.parentLocationId);
    if (!parent || isArea(place) || isArea(parent)) continue;
    const minutes = tierMinutes.get(depth.get(place.id) ?? 0) ?? 0;
    add({ from: parent.id, to: place.id, minutes, kind: 'inside', requires: [] });
    add({ from: place.id, to: parent.id, minutes, kind: 'inside', requires: [] });
  }

  const pace = module.ruleset.travel.walkKph;
  for (const route of module.world.routes) {
    const minutes = Math.round((route.distanceKm / pace) * 60);
    const shared = { minutes, kind: 'route' as const, routeId: route.id, terrain: route.terrain, requires: route.requires };
    add({ ...shared, from: route.from, to: route.to });
    add({ ...shared, from: route.to, to: route.from });
  }

  const atlas: Atlas = { places, depth, edges };
  atlases.set(module, atlas);
  return atlas;
}

// The reason an edge is closed to the player right now, or null if it is open.
export function blockedBy(module: PraxisModule, values: StateValues, playerId: string, edge: Edge): string | null {
  for (const requirement of edge.requires) {
    if (requirement.toward !== undefined && requirement.toward !== edge.to) continue;
    const def: StateDef | undefined = stateDefFor(module, requirement.stateId, playerId);
    if (!def) return requirement.reason;
    if (read(values, def, playerId) < requirement.atLeast) return requirement.reason;
  }
  return null;
}

export interface Exit {
  edge: Edge;
  place: Place;
  blocked: string | null;
}

// Every place one hop from here, cheapest first.
export function exitsFrom(module: PraxisModule, values: StateValues, playerId: string, placeId: string): Exit[] {
  const atlas = atlasOf(module);
  return (atlas.edges.get(placeId) ?? [])
    .map((edge) => ({ edge, place: atlas.places.get(edge.to)!, blocked: blockedBy(module, values, playerId, edge) }))
    .sort((a, b) => a.edge.minutes - b.edge.minutes || a.place.name.localeCompare(b.place.name));
}

export type PathResult =
  | { ok: true; minutes: number; steps: Edge[] }
  | { ok: false; reason: string };

function shortest(module: PraxisModule, from: string, to: string, open: (edge: Edge) => boolean): { minutes: number; steps: Edge[] } | null {
  const atlas = atlasOf(module);
  const best = new Map<string, number>([[from, 0]]);
  const via = new Map<string, Edge>();
  const done = new Set<string>();
  // Worlds are small enough that a linear scan for the next place beats a heap's bookkeeping.
  while (true) {
    let current: string | null = null;
    let currentCost = Infinity;
    for (const [placeId, cost] of best) {
      if (!done.has(placeId) && cost < currentCost) { current = placeId; currentCost = cost; }
    }
    if (current === null) return null;
    if (current === to) break;
    done.add(current);
    for (const edge of atlas.edges.get(current) ?? []) {
      if (!open(edge)) continue;
      const cost = currentCost + edge.minutes;
      if (cost < (best.get(edge.to) ?? Infinity)) {
        best.set(edge.to, cost);
        via.set(edge.to, edge);
      }
    }
  }
  const steps: Edge[] = [];
  for (let at = to; at !== from;) {
    const edge = via.get(at)!;
    steps.unshift(edge);
    at = edge.from;
  }
  return { minutes: best.get(to) ?? 0, steps };
}

// The quickest open way from one place to another. When the only ways are closed, the
// reason names the first closed edge on the quickest of them, so the player learns what
// stands in the way rather than that there is no way.
export function findPath(module: PraxisModule, values: StateValues, playerId: string, from: string, to: string): PathResult {
  const atlas = atlasOf(module);
  const target = atlas.places.get(to);
  if (!target) return { ok: false, reason: 'That place is not in this world.' };
  if (isArea(target)) return { ok: false, reason: `${target.name} is an area, not somewhere to go. Choose a place inside it.` };
  if (from === to) return { ok: false, reason: `You are already at ${target.name}.` };

  const open = shortest(module, from, to, (edge) => blockedBy(module, values, playerId, edge) === null);
  if (open) return { ok: true, ...open };

  const anyWay = shortest(module, from, to, () => true);
  const closed = anyWay?.steps.find((edge) => blockedBy(module, values, playerId, edge) !== null);
  if (closed) return { ok: false, reason: blockedBy(module, values, playerId, closed)! };
  return { ok: false, reason: `There is no known way from here to ${target.name}.` };
}

// Every place a journey could end, with how long the quickest open way takes from here.
export function destinationsFrom(module: PraxisModule, values: StateValues, playerId: string, from: string): { place: Place; result: PathResult }[] {
  return module.world.places
    .filter((place) => place.id !== from && !isArea(place))
    .map((place) => ({ place, result: findPath(module, values, playerId, from, place.id) }))
    .sort((a, b) => a.place.name.localeCompare(b.place.name));
}
