import { describe, expect, it } from '@gjsify/unit';
import { EVENT_LIMIT, EXPAND_WINDOW_MAX_DAYS, listEvents } from '@reminder/core';

import { expandEvents } from '../../../src/core/expand-events.ts';
import { calendar, createFakeBackend } from '../fake-backend.ts';

const NOW = new Date(Date.UTC(2026, 9, 12, 6, 0));

const wrap = (...components: string[][]): string =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//reminder tests//EN',
    ...components.flat(),
    'END:VCALENDAR',
    '',
  ].join('\r\n');

const daily = (uid: string, extra: string[] = []): string =>
  wrap([
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'SUMMARY:Stand-up',
    'DTSTART:20261012T080000Z',
    'DTEND:20261012T081500Z',
    'RRULE:FREQ=DAILY',
    ...extra,
    'END:VEVENT',
  ]);

const moved = wrap(
  [
    'BEGIN:VEVENT',
    'UID:lesson',
    'SUMMARY:Lesson',
    'DTSTART:20261012T170000Z',
    'DTEND:20261012T180000Z',
    'RRULE:FREQ=WEEKLY',
    'END:VEVENT',
  ],
  [
    'BEGIN:VEVENT',
    'UID:lesson',
    'SUMMARY:Lesson (moved)',
    'RECURRENCE-ID:20261012T170000Z',
    'DTSTART:20261012T190000Z',
    'DTEND:20261012T200000Z',
    'END:VEVENT',
  ],
);

const backendWith = (...items: string[]) =>
  createFakeBackend([calendar('cal', 'event', 'Work')], { cal: items });

export default async () => {
  await describe('expandEvents', async () => {
    await it('leaves the default read as one row per series', async () => {
      const result = await listEvents(
        backendWith(daily('s1')),
        { from: '2026-10-12', to: '2026-10-18' },
        NOW,
      );
      expect(result.events.length).toBe(1);
    });

    await it('lists every instance in the window', async () => {
      const result = await expandEvents(
        backendWith(daily('s1')),
        { from: '2026-10-12', to: '2026-10-14' },
        NOW,
      );
      expect(result.occurrences.length).toBe(3);
      expect(result.occurrences.map((o) => o.start.slice(0, 10)).join(',')).toBe(
        '2026-10-12,2026-10-13,2026-10-14',
      );
      expect(result.occurrences[0].calendarUid).toBe('cal');
      expect(result.omitted).toBe(0);
    });

    await it('applies EXDATE and RECURRENCE-ID overrides', async () => {
      const cut = await expandEvents(
        backendWith(daily('s1', ['EXDATE:20261013T080000Z'])),
        { from: '2026-10-12', to: '2026-10-14' },
        NOW,
      );
      expect(cut.occurrences.map((o) => o.start.slice(0, 10)).join(',')).toBe('2026-10-12,2026-10-14');
      const over = await expandEvents(backendWith(moved), { from: '2026-10-12', to: '2026-10-12' }, NOW);
      expect(over.occurrences.length).toBe(1);
      expect(over.occurrences[0].override).toBe(true);
      expect(over.occurrences[0].summary).toBe('Lesson (moved)');
    });

    await it('clamps a long window and says so', async () => {
      const result = await expandEvents(
        backendWith(daily('s1')),
        { from: '2026-10-12', to: '2027-12-31' },
        NOW,
      );
      expect(result.clamped).toBe(true);
      expect(result.occurrences.length).toBe(EXPAND_WINDOW_MAX_DAYS);
    });

    await it('caps the rows and reports what was omitted', async () => {
      const result = await expandEvents(
        backendWith(daily('s1')),
        { from: '2026-10-12', to: '2026-12-31', limit: 10 },
        NOW,
      );
      expect(result.occurrences.length).toBe(10);
      expect(result.omitted).toBe(81 - 10);
      expect(EVENT_LIMIT.max >= 10).toBe(true);
    });

    await it('reports an unresolved zone instead of shifting the time', async () => {
      const ical = wrap([
        'BEGIN:VEVENT',
        'UID:z1',
        'SUMMARY:Call',
        'DTSTART;TZID=Nowhere/Atlantis:20261012T090000',
        'DTEND;TZID=Nowhere/Atlantis:20261012T100000',
        'END:VEVENT',
      ]);
      const result = await expandEvents(backendWith(ical), { from: '2026-10-12', to: '2026-10-12' }, NOW);
      expect(result.unresolvedZones.join(',')).toBe('Nowhere/Atlantis');
      expect(result.occurrences[0].zoneUnresolved).toBe(true);
      expect(result.occurrences[0].start).toBe('2026-10-12T09:00:00');
    });

    await it('rejects a window that ends before it starts', async () => {
      let message = '';
      try {
        await expandEvents(backendWith(daily('s1')), { from: '2026-10-14', to: '2026-10-12' }, NOW);
      } catch (err) {
        message = String(err);
      }
      expect(message.length > 0).toBe(true);
    });
  });
};
