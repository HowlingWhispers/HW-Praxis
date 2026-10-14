import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CALENDAR, calendarSchema, datePhrase, dayOf, durationWords, hourOf, minuteOf, monthOf, stamp, timeBandOf, weekdayOf,
} from '../src/engine';

const day = 24 * 60;

describe('clock', () => {
  it('splits minutes into day, hour and minute', () => {
    const t = 3 * day + 14 * 60 + 5;
    expect(dayOf(t)).toBe(3);
    expect(hourOf(t)).toBe(14);
    expect(minuteOf(t)).toBe(5);
  });

  it('floors story zero', () => {
    expect(dayOf(-500)).toBe(0);
    expect(hourOf(Number.NaN)).toBe(0);
  });

  it('walks months of different lengths and counts years from one', () => {
    expect(monthOf(DEFAULT_CALENDAR, 31 * day)).toEqual({ index: 1, name: 'February', dayOfMonth: 0, year: 1 });
    expect(monthOf(DEFAULT_CALENDAR, 365 * day)).toEqual({ index: 0, name: 'January', dayOfMonth: 0, year: 2 });
    expect(datePhrase(DEFAULT_CALENDAR, 2 * day)).toBe('the 3rd of January');
    expect(datePhrase(DEFAULT_CALENDAR, 10 * day)).toBe('the 11th of January');
  });

  it('reads a world without months or a week', () => {
    const bare = calendarSchema.parse({});
    expect(monthOf(bare, 5 * day)).toBeNull();
    expect(datePhrase(bare, 5 * day)).toBe('');
    expect(weekdayOf(bare, 5 * day)).toBe(-1);
    expect(stamp(bare, 5 * day + 90)).toBe('Day 6 01:30');
  });

  it('stamps with the weekday', () => {
    expect(stamp(DEFAULT_CALENDAR, day + 7 * 60 + 40)).toBe('Monday 07:40');
  });
});

describe('time bands', () => {
  it('finds the band for the hour, including one that wraps midnight', () => {
    expect(timeBandOf(DEFAULT_CALENDAR, 7 * 60)).toBe('early morning');
    expect(timeBandOf(DEFAULT_CALENDAR, 23 * 60)).toBe('deep night');
    expect(timeBandOf(DEFAULT_CALENDAR, 2 * 60)).toBe('the small hours');
  });

  it('matches nothing with a zero-width band', () => {
    const calendar = calendarSchema.parse({ bands: [{ label: 'never', from: 6, to: 6 }] });
    expect(timeBandOf(calendar, 6 * 60)).toBe('');
  });
});

describe('durations', () => {
  it('reads as words for the player', () => {
    expect(durationWords(0)).toBe('0 min');
    expect(durationWords(45)).toBe('45 min');
    expect(durationWords(135)).toBe('2 h 15 min');
    expect(durationWords(day + 180)).toBe('1 day 3 h');
  });
});
