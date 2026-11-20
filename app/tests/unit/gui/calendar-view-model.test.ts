import { describe, expect, it } from '@gjsify/unit';

import {
  calendarTitle,
  calendarWindow,
  describeCalendarFailures,
  eventTitle,
  firstWeekdayFor,
  occurrenceId,
  occurrenceSpan,
  shiftAnchor,
  startOfWeek,
  toCalendarEvents,
  wallClock,
  weekColumns,
  windowRange,
  ZONE_MARK,
  type CalendarOccurrence,
} from '../../../src/frontends/gui/calendar-view-model.ts';

const MONDAY = 1;

/** 2026-11-18 is a Wednesday; November 2026 starts on a Sunday and has 30 days. */
const WED = { year: 2026, month: 11, day: 18 };

function occurrence(extra: Partial<CalendarOccurrence> = {}): CalendarOccurrence {
  return {
    uid: 'e1',
    calendarUid: 'home:family',
    summary: 'Lunch',
    start: '2026-11-18T12:30',
    end: '2026-11-18T13:30',
    allDay: false,
    floating: true,
    tzid: null,
    zoneUnresolved: false,
    ...extra,
  };
}

const colour = (uid: string): string => `#${uid.length}`;

export default async () => {
  await describe('week columns', async () => {
    await it('gives the full week only where seven fit', async () => {
      expect(weekColumns('wide')).toBe(7);
      expect(weekColumns('medium')).toBe(5);
      expect(weekColumns('compact')).toBe(3);
    });
  });

  await describe('first weekday', async () => {
    await it('takes the explicit setting over the locale', async () => {
      expect(firstWeekdayFor('monday', 'en-US')).toBe(1);
      expect(firstWeekdayFor('sunday', 'de-DE')).toBe(0);
      expect(firstWeekdayFor('saturday', 'de-DE')).toBe(6);
    });

    await it('falls back to a weekday the locale could name', async () => {
      const first = firstWeekdayFor('system', 'de-DE');
      expect(first >= 0 && first <= 6).toBe(true);
    });
  });

  await describe('start of week', async () => {
    await it('walks back to the first weekday', async () => {
      expect(windowRange({ first: startOfWeek(WED, MONDAY), days: 1 }).from).toBe('2026-11-16');
      expect(windowRange({ first: startOfWeek(WED, 0), days: 1 }).from).toBe('2026-11-15');
    });

    await it('leaves a day that already is the first weekday alone', async () => {
      const monday = { year: 2026, month: 11, day: 16 };
      expect(windowRange({ first: startOfWeek(monday, MONDAY), days: 1 }).from).toBe('2026-11-16');
    });
  });

  await describe('window', async () => {
    await it('covers the whole six-row month grid, neighbours included', async () => {
      const window = calendarWindow('month', WED, MONDAY);
      expect(window.days).toBe(42);
      // The 1st is a Sunday, so a Monday grid opens on the Monday of the week before.
      expect(windowRange(window)).toStrictEqual({ from: '2026-10-26', to: '2026-12-06' });
    });

    await it('aligns a full week to the first weekday', async () => {
      expect(windowRange(calendarWindow('week', WED, MONDAY, 7))).toStrictEqual({
        from: '2026-11-16',
        to: '2026-11-22',
      });
    });

    await it('runs a short week forward from the anchor', async () => {
      expect(windowRange(calendarWindow('week', WED, MONDAY, 3))).toStrictEqual({
        from: '2026-11-18',
        to: '2026-11-20',
      });
    });

    await it('is the one day in day mode', async () => {
      expect(windowRange(calendarWindow('day', WED, MONDAY))).toStrictEqual({
        from: '2026-11-18',
        to: '2026-11-18',
      });
    });
  });

  await describe('navigation', async () => {
    await it('steps months and clamps a day the next month has not got', async () => {
      expect(shiftAnchor('month', { year: 2026, month: 1, day: 31 }, 1)).toStrictEqual({
        year: 2026,
        month: 2,
        day: 28,
      });
      expect(shiftAnchor('month', { year: 2026, month: 1, day: 15 }, -1)).toStrictEqual({
        year: 2025,
        month: 12,
        day: 15,
      });
      expect(shiftAnchor('month', { year: 2026, month: 12, day: 15 }, 1)).toStrictEqual({
        year: 2027,
        month: 1,
        day: 15,
      });
    });

    await it('steps a week by the days it shows', async () => {
      expect(shiftAnchor('week', WED, 1, 7)).toStrictEqual({ year: 2026, month: 11, day: 25 });
      expect(shiftAnchor('week', WED, 1, 3)).toStrictEqual({ year: 2026, month: 11, day: 21 });
      expect(shiftAnchor('week', WED, -1, 3)).toStrictEqual({ year: 2026, month: 11, day: 15 });
    });

    await it('steps a day over a month boundary', async () => {
      expect(shiftAnchor('day', { year: 2026, month: 11, day: 30 }, 1)).toStrictEqual({
        year: 2026,
        month: 12,
        day: 1,
      });
    });
  });

  await describe('title', async () => {
    await it('names the month in month mode', async () => {
      const window = calendarWindow('month', WED, MONDAY);
      const title = calendarTitle('month', WED, window, 'en-GB');
      expect(title.includes('November')).toBe(true);
      expect(title.includes('2026')).toBe(true);
    });

    await it('writes a span once when it stays in one month', async () => {
      const window = calendarWindow('week', WED, MONDAY, 7);
      // "16 – 22 Nov 2026": the opening day carries no month of its own.
      expect(calendarTitle('week', WED, window, 'en-GB')).toBe('16 – 22 Nov 2026');
    });

    await it('writes both months when the span crosses one', async () => {
      const anchor = { year: 2026, month: 11, day: 30 };
      const window = calendarWindow('week', anchor, MONDAY, 3);
      expect(calendarTitle('week', anchor, window, 'en-GB')).toBe('30 Nov – 2 Dec 2026');
    });

    await it('names the single day in day mode', async () => {
      const window = calendarWindow('day', WED, MONDAY);
      const title = calendarTitle('day', WED, window, 'en-GB');
      expect(title.includes('18')).toBe(true);
      expect(title.includes('Nov')).toBe(true);
    });
  });

  await describe('bounds', async () => {
    await it('reads a bare date as that day', async () => {
      expect(wallClock('2026-11-18')).toStrictEqual({ year: 2026, month: 11, day: 18 });
    });

    await it('reads a floating time exactly as written', async () => {
      expect(wallClock('2026-11-18T09:30')).toStrictEqual({
        year: 2026,
        month: 11,
        day: 18,
        hour: 9,
        minute: 30,
      });
    });

    await it('refuses a string that is neither', async () => {
      expect(wallClock('tomorrow')).toBe(null);
      expect(wallClock('')).toBe(null);
    });
  });

  await describe('identity', async () => {
    await it('tells two instances of one series apart', async () => {
      const a = occurrence({ recurrenceId: '2026-11-18T09:30' });
      const b = occurrence({ recurrenceId: '2026-11-19T09:30' });
      expect(occurrenceId(a) === occurrenceId(b)).toBe(false);
    });

    await it('keeps two calendars that share a uid apart', async () => {
      const a = occurrence({ calendarUid: 'home:family' });
      const b = occurrence({ calendarUid: 'work:family' });
      expect(occurrenceId(a) === occurrenceId(b)).toBe(false);
    });

    await it('is the same across a reload', async () => {
      expect(occurrenceId(occurrence())).toBe(occurrenceId(occurrence()));
    });
  });

  await describe('mapping', async () => {
    await it('drops hidden sources and keeps the rest', async () => {
      const events = toCalendarEvents(
        [occurrence(), occurrence({ uid: 'e2', calendarUid: 'work:team' })],
        new Set(['work:team']),
        colour,
      );
      expect(events.length).toBe(1);
      expect(events[0].payload.title).toBe('Lunch');
      expect(events[0].payload.colour).toBe(colour('home:family'));
    });

    await it('carries the geometry the widgets lay out with', async () => {
      const [event] = toCalendarEvents([occurrence()], new Set(), colour);
      expect(event.allDay).toBe(false);
      expect(event.start.hour).toBe(12);
      expect(event.start.minute).toBe(30);
      expect(event.end.hour).toBe(13);
    });

    await it('leaves out an occurrence whose bounds do not parse', async () => {
      expect(toCalendarEvents([occurrence({ start: 'soon' })], new Set(), colour).length).toBe(0);
    });

    await it('marks an unresolved zone instead of shifting the clock', async () => {
      const flagged = occurrence({ zoneUnresolved: true, tzid: 'Europe/Nowhere' });
      const [event] = toCalendarEvents([flagged], new Set(), colour);
      expect(event.payload.title.includes(ZONE_MARK)).toBe(true);
      expect(event.start.hour).toBe(12);
      expect(eventTitle(flagged).startsWith('Lunch')).toBe(true);
    });

    await it('passes a location through for the agenda', async () => {
      const [event] = toCalendarEvents([occurrence({ location: 'Café Hain' })], new Set(), colour);
      expect(event.payload.location).toBe('Café Hain');
    });
  });

  await describe('span', async () => {
    await it('writes the two clocks of a timed instance', async () => {
      expect(occurrenceSpan(occurrence(), 'en-GB')).toBe('12:30 – 13:30');
    });

    await it('says all day for a one-day all-day item', async () => {
      const allDay = occurrence({ start: '2026-11-18', end: '2026-11-19', allDay: true });
      expect(occurrenceSpan(allDay, 'en-GB').includes('18')).toBe(false);
    });

    await it('ends a multi-day item on its last day, not the exclusive one', async () => {
      const trip = occurrence({ start: '2026-11-18', end: '2026-11-21', allDay: true });
      const text = occurrenceSpan(trip, 'en-GB');
      expect(text.includes('20')).toBe(true);
      expect(text.includes('21')).toBe(false);
    });
  });

  await describe('failures', async () => {
    await it('is silent when every source answered', async () => {
      expect(describeCalendarFailures([])).toBe(null);
    });

    await it('names each source that did not', async () => {
      const text = describeCalendarFailures([
        { name: 'Work', message: 'timed out' },
        { name: 'Family', message: 'no network' },
      ]);
      expect((text ?? '').includes('Work: timed out')).toBe(true);
      expect((text ?? '').includes('Family: no network')).toBe(true);
    });
  });
};
