import { describe, expect, it } from '@gjsify/unit';
import { listEvents, listReminders } from '@reminder/core';

import { calendar, createFakeBackend, vevent, vtodo } from '../fake-backend.ts';

const NOW = new Date('2026-10-10T09:00:00Z');

export default async () => {
  await describe('listEvents', async () => {
    const backend = createFakeBackend(
      [calendar('cal-a', 'event'), calendar('cal-b', 'event'), calendar('list', 'reminder')],
      {
        'cal-a': [
          vevent('late', ['DTSTART:20261012T150000Z', 'SUMMARY:Late']),
          vevent('early', ['DTSTART:20261012T080000Z', 'SUMMARY:Early']),
          vevent('broken', ['SUMMARY:no start']),
        ],
        'cal-b': [vevent('allday', ['DTSTART;VALUE=DATE:20261011', 'SUMMARY:Holiday'])],
      },
    );

    await it('sorts by start across calendars and drops unreadable items', async () => {
      const r = await listEvents(backend, {}, NOW);
      expect(r.events.map((e) => e.uid)).toEqualArray(['allday', 'early', 'late']);
      expect(r.from).toBe('2026-10-10T00:00:00.000Z');
      expect(r.to).toBe('2026-11-10T00:00:00.000Z');
      expect(r.omitted).toBe(0);
    });

    await it('makes a bare `to` date inclusive', async () => {
      const r = await listEvents(backend, { from: '2026-10-11', to: '2026-10-11' }, NOW);
      expect(r.to).toBe('2026-10-12T00:00:00.000Z');
      expect(r.events.map((e) => e.uid)).toEqualArray(['allday']);
    });

    await it('reports what the limit cut', async () => {
      const r = await listEvents(backend, { limit: 1 }, NOW);
      expect(r.events.length).toBe(1);
      expect(r.omitted).toBe(2);
    });

    await it('restricts to one calendar', async () => {
      const r = await listEvents(backend, { calendar: 'cal-b' }, NOW);
      expect(r.events.map((e) => e.calendarUid)).toEqualArray(['cal-b']);
    });
  });

  await describe('listReminders', async () => {
    const backend = createFakeBackend([calendar('list', 'reminder')], {
      list: [
        vtodo('undated', ['SUMMARY:Someday']),
        vtodo('later', ['SUMMARY:Later', 'DUE;VALUE=DATE:20261030']),
        vtodo('sooner', ['SUMMARY:Sooner', 'DUE:20261015T100000Z']),
        vtodo('done', ['SUMMARY:Done', 'STATUS:COMPLETED', 'DUE;VALUE=DATE:20261001']),
      ],
    });

    await it('lists open reminders by due date, undated last', async () => {
      const r = await listReminders(backend);
      expect(r.reminders.map((x) => x.uid)).toEqualArray(['sooner', 'later', 'undated']);
    });

    await it('includes completed ones with all', async () => {
      const r = await listReminders(backend, { all: true });
      expect(r.reminders.map((x) => x.uid)).toEqualArray(['done', 'sooner', 'later', 'undated']);
    });
  });
};
