import { describe, expect, it } from '@gjsify/unit';
import { BackendError, type CalendarBackend } from '@reminder/core';

import { createCalendarModel } from '../../../src/frontends/gui/calendar-model.ts';
import { calendar, createFakeBackend, vevent } from '../fake-backend.ts';

const NOW = new Date(2026, 10, 18, 9, 0);
const WINDOW = { from: '2026-11-16', to: '2026-11-22' };

function backendWith(): CalendarBackend {
  return createFakeBackend(
    [
      calendar('home:family', 'event', 'Family'),
      calendar('work:team', 'event', 'Team'),
      calendar('home:tasks', 'reminder'),
    ],
    {
      'home:family': [vevent('e1', ['SUMMARY:Lunch', 'DTSTART:20261118T123000', 'DTEND:20261118T133000'])],
      'work:team': [vevent('e2', ['SUMMARY:Review', 'DTSTART:20261119T100000', 'DTEND:20261119T110000'])],
    },
  );
}

/** Fails for one calendar only, the way a single unreachable account does. */
function breaking(base: CalendarBackend, broken: string): CalendarBackend {
  return {
    ...base,
    async listItems(query) {
      if (query.calendarUid === broken) throw new BackendError('the server said no');
      return base.listItems(query);
    },
  };
}

export default async () => {
  await describe('calendar model', async () => {
    await it('reads events from every event calendar and leaves task lists out', async () => {
      const model = createCalendarModel({ backend: backendWith(), now: () => NOW });
      const load = await model.load(WINDOW);
      expect(load.occurrences.length).toBe(2);
      expect(load.failures.length).toBe(0);
      expect(model.calendars().every((c) => c.kind === 'event')).toBe(true);
    });

    await it('names the calendars it knows, for the detail pane', async () => {
      const model = createCalendarModel({ backend: backendWith(), now: () => NOW });
      await model.load(WINDOW);
      expect(model.calendar('home:family')?.name).toBe('Family');
      expect(model.calendar('nowhere')).toBe(null);
    });

    await it('keeps the sources that answered when one fails (ADR 0005)', async () => {
      const model = createCalendarModel({
        backend: breaking(backendWith(), 'work:team'),
        now: () => NOW,
      });
      const load = await model.load(WINDOW);
      expect(load.occurrences.length).toBe(1);
      expect(load.occurrences[0].calendarUid).toBe('home:family');
      expect(load.failures.length).toBe(1);
      expect(load.failures[0].name).toBe('Team');
      expect(load.failures[0].message.includes('the server said no')).toBe(true);
    });
  });
};
