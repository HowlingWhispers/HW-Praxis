// Schedules: where people go when the story is not watching, Character Engine's shape.
//
// A person with a schedule follows it as the clock moves. They move only when the clock
// crosses into a different stop, so someone the player put somewhere by hand stays there
// until their day next takes them elsewhere. The player's own character never follows one.
//
// Pure: the clock comes in as an argument.

import { calendarOf, isArea, atlasOf } from './world';
import { dayOf, hourOf, monthOf, weekdayOf, type Calendar } from './clock';
import type { Character, DayPlan, PraxisModule, Schedule, ScheduleRow } from './module';
import type { LedgerEntry, Save } from './session';

// The plan for the day holding minute t: the first rule that matches, or the ordinary day.
export function planFor(calendar: Calendar, schedule: Schedule, t: number): DayPlan {
  const day = dayOf(t);
  const weekday = weekdayOf(calendar, t);
  const month = monthOf(calendar, t);
  for (const rule of schedule.rules) {
    const { when } = rule;
    if (when.weekday !== undefined && when.weekday !== weekday) continue;
    if (when.month !== undefined && when.month !== month?.index) continue;
    if (when.monthDay !== undefined && when.monthDay !== month?.dayOfMonth) continue;
    if (when.fromDay !== undefined && day < when.fromDay) continue;
    if (when.toDay !== undefined && day > when.toDay) continue;
    const plan = schedule.plans.find((entry) => entry.id === rule.planId);
    if (plan) return plan;
  }
  return schedule.plans[0]!;
}

// The stop in force at an hour: the last to start at or before it, or, before the first
// stop of the day, the last stop of the day running on past midnight.
export function rowAt(plan: DayPlan, hour: number): ScheduleRow {
  const rows = [...plan.rows].sort((a, b) => a.fromHour - b.fromHour);
  let found = rows[rows.length - 1]!;
  for (const row of rows) if (row.fromHour <= hour) found = row;
  return found;
}

export interface Whereabouts {
  plan: DayPlan;
  row: ScheduleRow;
  // When this stop began and ends, in story minutes, so a stop can be told apart from the
  // same stop on another day.
  from: number;
  until: number;
}

export function whereabouts(calendar: Calendar, character: Character, t: number): Whereabouts | null {
  if (!character.schedule) return null;
  const plan = planFor(calendar, character.schedule, t);
  const hour = hourOf(t);
  const row = rowAt(plan, hour);
  const hours = [...new Set(plan.rows.map((entry) => entry.fromHour))].sort((a, b) => a - b);
  const dayStart = dayOf(t) * 1440;
  const started = row.fromHour <= hour ? dayStart + row.fromHour * 60 : dayStart - 1440 + row.fromHour * 60;
  const next = hours.find((value) => value > row.fromHour);
  const until = next !== undefined ? started - row.fromHour * 60 + next * 60 : started - row.fromHour * 60 + 1440 + hours[0]! * 60;
  return { plan, row, from: started, until };
}

export interface ScheduleResult {
  save: Save;
  entries: LedgerEntry[];
  // People who left the player's place, who came to it, and who came by and went on again,
  // while the clock moved.
  left: { character: Character; to: string }[];
  arrived: Character[];
  passed: { character: Character; to: string }[];
}

// The stops someone's day passes through after `from`, up to and including the one in force
// at `to`. Long spans are cut to their last three days: nobody watched the rest.
function stopsBetween(calendar: Calendar, character: Character, from: number, to: number): string[] {
  const out: string[] = [];
  let t = Math.max(from, to - 3 * 1440);
  let where = whereabouts(calendar, character, t);
  for (let steps = 0; where && steps < 200; steps += 1) {
    if (where.until > to) break;
    t = where.until;
    where = whereabouts(calendar, character, t);
    if (where) out.push(where.row.locationId);
  }
  return out;
}

// Moves everyone whose day has taken them to a new stop between `from` and `to`. Entries are
// the rules' own; the player can put anyone back by hand.
export function followSchedules(module: PraxisModule, save: Save, from: number, to: number): ScheduleResult {
  const quiet: ScheduleResult = { save, entries: [], left: [], arrived: [], passed: [] };
  if (to <= from) return quiet;
  const calendar = calendarOf(module);
  const places = atlasOf(module).places;
  const playerId = module.scenario.playerCharacterId;
  const here = save.positions[playerId];
  const positions: Record<string, string> = { ...save.positions };
  const entries: LedgerEntry[] = [];
  const left: ScheduleResult['left'] = [];
  const arrived: Character[] = [];
  const passed: ScheduleResult['passed'] = [];
  for (const character of module.characters) {
    if (character.id === playerId || !character.schedule) continue;
    const before = whereabouts(calendar, character, from);
    const after = whereabouts(calendar, character, to);
    if (!before || !after) continue;
    if (before.from === after.from && before.row.locationId === after.row.locationId) continue;
    // Someone whose day brought them here and on again while the player stayed.
    const stops = stopsBetween(calendar, character, from, to);
    if (here && positions[character.id] !== here && after.row.locationId !== here && stops.slice(0, -1).includes(here)) {
      passed.push({ character, to: after.row.locationId });
    }
    const target = after.row.locationId;
    if (!places.has(target) || isArea(places.get(target))) continue;
    const was = positions[character.id] ?? null;
    if (was === target) continue;
    positions[character.id] = target;
    entries.push({ kind: 'move', at: to, characterId: character.id, from: was, to: target, minutes: 0, source: 'rule' });
    if (here && was === here) left.push({ character, to: target });
    if (here && target === here) arrived.push(character);
  }
  if (!entries.length) return quiet;
  return { save: { ...save, positions, ledger: [...save.ledger, ...entries] }, entries, left, arrived, passed };
}

// Where everyone with a schedule is at minute t, for a fresh save.
export function scheduledPositions(module: PraxisModule, t: number): Record<string, string> {
  const calendar = calendarOf(module);
  const places = atlasOf(module).places;
  const out: Record<string, string> = {};
  for (const character of module.characters) {
    if (character.id === module.scenario.playerCharacterId) continue;
    const where = whereabouts(calendar, character, t);
    if (where && places.has(where.row.locationId) && !isArea(places.get(where.row.locationId))) out[character.id] = where.row.locationId;
  }
  return out;
}

// What a person is doing now, when they are where their day puts them. Empty otherwise:
// someone moved by hand is not doing what their schedule says.
export function doingNow(module: PraxisModule, save: Save, character: Character): string {
  const where = whereabouts(calendarOf(module), character, save.clock);
  if (!where || save.positions[character.id] !== where.row.locationId) return '';
  return where.row.doing.trim();
}
