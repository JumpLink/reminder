import { describe, expect, it } from '@gjsify/unit';
import {
  createEvent,
  createReminder,
  GrantDeniedError,
  parseConfig,
  ReminderError,
  RoutingError,
  uidForSourceKey,
  type CreateDeps,
} from '@reminder/core';

import { calendar, createFakeBackend, vevent } from '../fake-backend.ts';

const now = () => new Date('2026-10-10T12:00:00Z');

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  return null;
}

function setup(extraItems: Record<string, string[]> = {}) {
  const backend = createFakeBackend(
    [calendar('cal-work', 'event'), calendar('cal-home', 'event'), calendar('list-todo', 'reminder')],
    extraItems,
  );
  const config = parseConfig({
    grants: [
      { capability: 'calendar.create', target: 'cal-work' },
      { capability: 'reminder.create', target: 'list-todo' },
    ],
    routes: [{ concerns: ['work'], kind: 'event', target: 'cal-work' }],
    defaults: { event: 'cal-home', reminder: 'list-todo' },
  });
  const deps: CreateDeps = { backend, config, now };
  return { backend, deps };
}

export default async () => {
  await describe('createEvent', async () => {
    await it('routes by concern, writes, and stores the source key', async () => {
      const { backend, deps } = setup();
      const r = await createEvent(deps, {
        concern: 'Work',
        source: 'mail',
        sourceId: '<m1@example.org>',
        summary: 'Review',
        start: '2026-10-12T10:00:00Z',
      });
      expect(r.created).toBe(true);
      expect(r.calendarUid).toBe('cal-work');
      expect(r.uid).toBe(uidForSourceKey('mail:<m1@example.org>'));
      expect(backend.store.get('cal-work')?.[0]).toContain('X-REMINDER-SOURCE:mail:<m1@example.org>');
    });

    await it('is idempotent for the same source key', async () => {
      const { backend, deps } = setup();
      const input = {
        calendar: 'cal-work',
        source: 'mail',
        sourceId: 'x',
        summary: 'A',
        start: '2026-10-12',
      };
      expect((await createEvent(deps, input)).created).toBe(true);
      const second = await createEvent(deps, input);
      expect(second.created).toBe(false);
      expect(backend.store.get('cal-work')?.length).toBe(1);
      expect(backend.calls.filter((c) => c.startsWith('createItem')).length).toBe(1);
    });

    await it('refuses a UID that holds a different source', async () => {
      const uid = uidForSourceKey('mail:x');
      const { deps } = setup({
        'cal-work': [vevent(uid, ['DTSTART:20261012T100000Z', 'X-REMINDER-SOURCE:other:y'])],
      });
      const err = await rejection(
        createEvent(deps, {
          calendar: 'cal-work',
          source: 'mail',
          sourceId: 'x',
          summary: 'A',
          start: '2026-10-12',
        }),
      );
      expect(err instanceof ReminderError).toBe(true);
      expect((err as Error).message).toContain('refusing to merge');
    });

    await it('denies the default calendar when it is not granted, before touching the backend', async () => {
      const { backend, deps } = setup();
      const err = await rejection(
        createEvent(deps, { source: 'mail', sourceId: 'y', summary: 'A', start: '2026-10-12' }),
      );
      expect(err instanceof GrantDeniedError).toBe(true);
      expect((err as GrantDeniedError).target).toBe('cal-home');
      expect(backend.calls).toEqualArray([]);
    });

    await it('refuses a granted target the backend does not have', async () => {
      const { deps } = setup();
      const config = parseConfig({ grants: [{ capability: 'calendar.create', target: 'cal-gone' }] });
      const err = await rejection(
        createEvent(
          { ...deps, config },
          { calendar: 'cal-gone', source: 'mail', sourceId: 'z', summary: 'A', start: '2026-10-12' },
        ),
      );
      expect((err as Error).message).toContain('no enabled calendar');
    });

    await it('refuses an empty summary', async () => {
      const { deps } = setup();
      const err = await rejection(
        createEvent(deps, {
          calendar: 'cal-work',
          source: 'mail',
          sourceId: 'z',
          summary: ' ',
          start: '2026-10-12',
        }),
      );
      expect((err as Error).message).toContain('summary');
    });
  });

  await describe('createReminder', async () => {
    await it('uses the reminder default and its own capability', async () => {
      const { backend, deps } = setup();
      const r = await createReminder(deps, {
        source: 'mail',
        sourceId: 'r1',
        summary: 'Reply',
        due: '2026-10-20',
      });
      expect(r.calendarUid).toBe('list-todo');
      expect(backend.store.get('list-todo')?.[0]).toContain('BEGIN:VTODO');
    });

    await it('does not let calendar.create stand in for reminder.create', async () => {
      const { deps } = setup();
      const err = await rejection(
        createReminder(deps, { calendar: 'cal-work', source: 'mail', sourceId: 'r2', summary: 'X' }),
      );
      expect(err instanceof GrantDeniedError).toBe(true);
    });

    await it('errors when no target can be resolved', async () => {
      const { deps } = setup();
      const config = parseConfig({});
      const err = await rejection(
        createReminder({ ...deps, config }, { source: 'mail', sourceId: 'r3', summary: 'X' }),
      );
      expect(err instanceof RoutingError).toBe(true);
    });
  });
};
