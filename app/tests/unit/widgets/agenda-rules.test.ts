import { describe, expect, it } from '@gjsify/unit';
import type { CalendarItem } from '@gjsify/calendar-layout';
import { groupByDay } from '@gjsify/adwaita-extended/agenda-rules';

const allDay = (id: string, day: number, endDay = day + 1): CalendarItem<string> => ({
  id,
  start: { year: 2024, month: 1, day },
  end: { year: 2024, month: 1, day: endDay },
  allDay: true,
  payload: id,
});

const timed = (id: string, day: number, h1: number, h2: number, endDay = day): CalendarItem<string> => ({
  id,
  start: { year: 2024, month: 1, day, hour: h1, minute: 0 },
  end: { year: 2024, month: 1, day: endDay, hour: h2, minute: 0 },
  allDay: false,
  payload: id,
});

export default async () => {
  await describe('agenda rules', async () => {
    await it('groups by day and skips the days nothing happens on', async () => {
      const days = groupByDay([timed('b', 10, 9, 10), timed('a', 8, 14, 15)]);
      expect(days).toHaveLength(2);
      expect(days[0]?.date).toStrictEqual({ year: 2024, month: 1, day: 8 });
      expect(days[1]?.date).toStrictEqual({ year: 2024, month: 1, day: 10 });
      expect(days[0]?.entries[0]?.id).toBe('a');
    });

    await it('puts all-day items first, then the timed ones by start', async () => {
      const days = groupByDay([timed('late', 8, 16, 17), timed('early', 8, 9, 10), allDay('whole', 8)]);
      expect(days[0]?.entries.map((e) => e.id)).toEqualArray(['whole', 'early', 'late']);
      expect(days[0]?.entries[0]?.start).toBeNull();
      expect(days[0]?.entries[0]?.end).toBeNull();
      expect(days[0]?.entries[1]?.start).toBe(9 * 60);
      expect(days[0]?.entries[1]?.end).toBe(10 * 60);
    });

    await it('keeps the order stable when two items start together', async () => {
      const days = groupByDay([timed('z', 8, 9, 10), timed('a', 8, 9, 10)]);
      expect(days[0]?.entries.map((e) => e.id)).toEqualArray(['a', 'z']);
      const both = groupByDay([allDay('z', 8), allDay('a', 8)]);
      expect(both[0]?.entries.map((e) => e.id)).toEqualArray(['a', 'z']);
    });

    await it('lists a multi-day item under every day it touches, clipped there', async () => {
      const days = groupByDay([allDay('trip', 8, 11)]);
      expect(days).toHaveLength(3);
      expect(days[0]?.entries[0]?.continuesBefore).toBe(false);
      expect(days[0]?.entries[0]?.continuesAfter).toBe(true);
      expect(days[1]?.entries[0]?.continuesBefore).toBe(true);
      expect(days[1]?.entries[0]?.continuesAfter).toBe(true);
      expect(days[2]?.entries[0]?.continuesAfter).toBe(false);
    });

    await it('clips a timed item that crosses midnight to each day', async () => {
      const days = groupByDay([timed('night', 8, 22, 2, 9)]);
      expect(days).toHaveLength(2);
      expect(days[0]?.entries[0]?.start).toBe(22 * 60);
      expect(days[0]?.entries[0]?.end).toBe(1440);
      expect(days[0]?.entries[0]?.continuesAfter).toBe(true);
      expect(days[1]?.entries[0]?.start).toBe(0);
      expect(days[1]?.entries[0]?.end).toBe(2 * 60);
      expect(days[1]?.entries[0]?.continuesBefore).toBe(true);
    });

    await it('keeps only the window the caller asked for', async () => {
      const items = [allDay('trip', 6, 12), timed('inside', 9, 9, 10), timed('after', 20, 9, 10)];
      const days = groupByDay(items, { first: { year: 2024, month: 1, day: 8 }, days: 3 });
      expect(days.map((d) => d.date.day)).toEqualArray([8, 9, 10]);
      // The trip is clipped to the window, but still says it began earlier and goes on.
      expect(days[0]?.entries[0]?.id).toBe('trip');
      expect(days[0]?.entries[0]?.continuesBefore).toBe(true);
      expect(days[2]?.entries[0]?.continuesAfter).toBe(true);
      expect(groupByDay(items, { first: { year: 2024, month: 1, day: 8 }, days: 0 })).toHaveLength(0);
    });

    await it('answers an empty list with no days', async () => {
      expect(groupByDay([])).toHaveLength(0);
    });
  });
};
