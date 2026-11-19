import { describe, expect, it } from '@gjsify/unit';
import {
  dayHeading,
  hourLabel,
  isoDate,
  monthTitle,
  parseIsoDate,
  shortDayHeading,
  timeLabel,
  timeRangeLabel,
  usesHour12,
  weekdayNames,
} from '@gjsify/adwaita-extended/calendar-format';

export default async () => {
  await describe('calendar format', async () => {
    await it('writes and reads back a plain calendar date', async () => {
      expect(isoDate({ year: 2024, month: 1, day: 8 })).toBe('2024-01-08');
      expect(isoDate({ year: 999, month: 12, day: 31 })).toBe('999-12-31');
      expect(parseIsoDate('2024-01-08')).toStrictEqual({ year: 2024, month: 1, day: 8 });
      expect(parseIsoDate(' 2024-01-08 ')).toStrictEqual({ year: 2024, month: 1, day: 8 });
      expect(parseIsoDate('2024-13-01')).toBeNull();
      expect(parseIsoDate('2024-01-00')).toBeNull();
      expect(parseIsoDate('not a date')).toBeNull();
    });

    await it('starts the weekday names on the first weekday of the locale', async () => {
      const sunday = weekdayNames(0, 'en-GB', 'long');
      expect(sunday[0]).toBe('Sunday');
      expect(sunday[6]).toBe('Saturday');
      const monday = weekdayNames(1, 'en-GB', 'long');
      expect(monday[0]).toBe('Monday');
      expect(monday[6]).toBe('Sunday');
      expect(weekdayNames(1, 'de-DE', 'long')[0]).toBe('Montag');
      expect(weekdayNames(1, 'en-GB', 'short')).toHaveLength(7);
    });

    await it('names a month and a day in the reader locale', async () => {
      expect(monthTitle(2024, 1, 'de-DE')).toBe('Januar 2024');
      expect(monthTitle(2024, 1, 'en-GB')).toBe('January 2024');
      expect(dayHeading({ year: 2024, month: 1, day: 8 }, 'de-DE')).toContain('Januar');
      expect(dayHeading({ year: 2024, month: 1, day: 8 }, 'de-DE')).toContain('Montag');
      expect(shortDayHeading({ year: 2024, month: 1, day: 8 }, 'en-GB')).toContain('Mon');
    });

    await it('keeps the hour gutter to a number on a 24-hour clock', async () => {
      expect(usesHour12('de-DE')).toBe(false);
      expect(usesHour12('en-US')).toBe(true);
      expect(hourLabel(9, 'de-DE')).toBe('09');
      expect(hourLabel(0, 'de-DE')).toBe('00');
      expect(hourLabel(23, 'de-DE')).toBe('23');
      // Out of range wraps rather than throwing: an hour comes from arithmetic on a range.
      expect(hourLabel(24, 'de-DE')).toBe('00');
      expect(hourLabel(-1, 'de-DE')).toBe('23');
      expect(hourLabel(9, 'en-US')).toMatch(/9/);
    });

    await it('writes a time of day from minutes since midnight', async () => {
      expect(timeLabel(9 * 60 + 5, 'de-DE')).toBe('09:05');
      expect(timeLabel(0, 'de-DE')).toBe('00:00');
      expect(timeLabel(23 * 60 + 59, 'de-DE')).toBe('23:59');
      expect(timeLabel(1440, 'de-DE')).toBe('00:00');
      expect(timeLabel(-15, 'de-DE')).toBe('23:45');
      expect(timeRangeLabel(9 * 60, 10 * 60 + 30, 'de-DE')).toBe('09:00 – 10:30');
    });
  });
};
