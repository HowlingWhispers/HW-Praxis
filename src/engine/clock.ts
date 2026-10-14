// The story clock, ported from Character Engine.
//
// One integer is stored: minutes since story zero. Every word is derived and nothing derived
// is written back. Minutes per hour and hours per day are constants; the week and the year
// are authored (as many days as there are day names, as many months as are listed).
//
// The model sees the time band and nothing else. The stamp, the date phrase and the raw
// count are for the player and the author: a raw magnitude in context is what bands exist
// to prevent, and the clock is the largest magnitude in a save.

import { z } from 'zod';

export const MINUTES_PER_HOUR = 60;
export const HOURS_PER_DAY = 24;
export const MINUTES_PER_DAY = MINUTES_PER_HOUR * HOURS_PER_DAY;

export const timeBandSchema = z.object({
  label: z.string().min(1).max(80),
  // Whole hours. A band whose `from` is after its `to` wraps past midnight. Equal bounds
  // match nothing: a zero-width band is a mistake, and reading it as "always" would
  // silently replace every other band.
  from: z.number().int().min(0).max(23),
  to: z.number().int().min(0).max(23),
});

export const monthSchema = z.object({
  name: z.string().min(1).max(80),
  days: z.number().int().min(1).max(400),
});

export const calendarSchema = z.object({
  dayNames: z.array(z.string().min(1).max(40)).max(20).default([]),
  months: z.array(monthSchema).max(40).default([]),
  bands: z.array(timeBandSchema).max(24).default([]),
});

export type TimeBand = z.infer<typeof timeBandSchema>;
export type Calendar = z.infer<typeof calendarSchema>;

// Five bands, because that is how a day divides in prose, written as the model should say them.
export const DEFAULT_TIME_BANDS: TimeBand[] = [
  { label: 'the small hours', from: 0, to: 5 },
  { label: 'early morning', from: 5, to: 9 },
  { label: 'the middle of the day', from: 9, to: 16 },
  { label: 'the evening', from: 16, to: 22 },
  { label: 'deep night', from: 22, to: 0 },
];

// The calendar a module gets when it names none: the real one. A default is never neutral,
// and an invented one would have to be deleted name by name by any world that writes its own.
// February has 28 days and there are no leap years, so every derivation agrees on one year length.
export const DEFAULT_CALENDAR: Calendar = {
  dayNames: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  months: [
    { name: 'January', days: 31 }, { name: 'February', days: 28 }, { name: 'March', days: 31 },
    { name: 'April', days: 30 }, { name: 'May', days: 31 }, { name: 'June', days: 30 },
    { name: 'July', days: 31 }, { name: 'August', days: 31 }, { name: 'September', days: 30 },
    { name: 'October', days: 31 }, { name: 'November', days: 30 }, { name: 'December', days: 31 },
  ],
  bands: DEFAULT_TIME_BANDS,
};

// Story zero is a floor: a story cannot run before it began, and negative operands to `%`
// would make every derivation disagree about the day.
export function safeMinutes(t: number): number {
  return Number.isFinite(t) ? Math.max(0, Math.floor(t)) : 0;
}

export function dayOf(t: number): number { return Math.floor(safeMinutes(t) / MINUTES_PER_DAY); }
export function hourOf(t: number): number { return Math.floor((safeMinutes(t) % MINUTES_PER_DAY) / MINUTES_PER_HOUR); }
export function minuteOf(t: number): number { return safeMinutes(t) % MINUTES_PER_HOUR; }

// -1 in a world with no week.
export function weekdayOf(calendar: Calendar, t: number): number {
  return calendar.dayNames.length ? dayOf(t) % calendar.dayNames.length : -1;
}

export interface MonthReading {
  index: number;
  name: string;
  dayOfMonth: number; // zero-based
  year: number; // one-based
}

// null in a world with no months. Walks the month list, because months differ in length
// and only their sum is constant.
export function monthOf(calendar: Calendar, t: number): MonthReading | null {
  const yearLength = calendar.months.reduce((sum, month) => sum + month.days, 0);
  if (!yearLength) return null;
  const absolute = dayOf(t);
  let day = absolute % yearLength;
  const year = Math.floor(absolute / yearLength) + 1;
  for (let index = 0; index < calendar.months.length; index++) {
    const month = calendar.months[index]!;
    if (day < month.days) return { index, name: month.name, dayOfMonth: day, year };
    day -= month.days;
  }
  return null;
}

// The only derivation that may reach the model.
export function timeBandOf(calendar: Calendar, t: number): string {
  const hour = hourOf(t);
  for (const band of calendar.bands) {
    if (band.from < band.to && hour >= band.from && hour < band.to) return band.label;
    if (band.from > band.to && (hour >= band.from || hour < band.to)) return band.label;
  }
  return '';
}

const pad = (n: number) => String(n).padStart(2, '0');

export function timeOfDay(t: number): string {
  return `${pad(hourOf(t))}:${pad(minuteOf(t))}`;
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const last = n % 10;
  return `${n}${last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th'}`;
}

// 'Tuesday 14:20', or 'Day 4 14:20' in a world with no week. For the player, never the model.
export function stamp(calendar: Calendar, t: number): string {
  const weekday = weekdayOf(calendar, t);
  const head = weekday >= 0 ? calendar.dayNames[weekday] : `Day ${dayOf(t) + 1}`;
  return `${head} ${timeOfDay(t)}`;
}

// 'the 3rd of March', or '' in a world with no months. For the player, never the model.
export function datePhrase(calendar: Calendar, t: number): string {
  const month = monthOf(calendar, t);
  return month ? `the ${ordinal(month.dayOfMonth + 1)} of ${month.name}` : '';
}

// A duration in words for the player: '2 h 15 min', '45 min', '1 day 3 h'.
export function durationWords(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const days = Math.floor(total / MINUTES_PER_DAY);
  const hours = Math.floor((total % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
  const mins = total % MINUTES_PER_HOUR;
  const parts: string[] = [];
  if (days) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
  if (hours) parts.push(`${hours} h`);
  if (mins || !parts.length) parts.push(`${mins} min`);
  return parts.join(' ');
}
