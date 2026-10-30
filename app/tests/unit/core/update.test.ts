import { describe, expect, it } from '@gjsify/unit';
import {
  buildReminderUpdate,
  ConflictError,
  GrantDeniedError,
  InputError,
  parseConfig,
  readReminder,
  ReminderError,
  rewriteComponent,
  updateReminder,
  type UpdateDeps,
} from '@reminder/core';

import { calendar, createFakeBackend, vtodo } from '../fake-backend.ts';

const now = () => new Date('2026-10-30T09:15:00Z');

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  return null;
}

/** A task as a foreign client would have left it: folded, alarmed, with its own X- properties. */
const RICH = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Some Other Client//EN',
  'BEGIN:VTODO',
  'UID:t-rich',
  'DTSTAMP:20260101T080000Z',
  'CREATED:20260101T080000Z',
  'SUMMARY:Renew the lease',
  'DESCRIPTION:Call the office and ask for the long form\\, then sign it and send it b',
  ' ack before the end of the month',
  'DUE;TZID=Europe/Berlin:20261115T090000',
  'PRIORITY:5',
  'STATUS:NEEDS-ACTION',
  'CATEGORIES:Home,Paperwork',
  'SEQUENCE:3',
  'X-APPLE-SORT-ORDER:12',
  'X-REMINDER-SOURCE:mail:<m1@example.org>',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'TRIGGER:-PT30M',
  'SUMMARY:Alarm title, not the task title',
  'END:VALARM',
  'END:VTODO',
  'END:VCALENDAR',
  '',
].join('\r\n');

function setup(items: Record<string, string[]> = { 'list-todo': [vtodo('t1', ['SUMMARY:Reply'])] }) {
  const backend = createFakeBackend(
    [calendar('list-todo', 'reminder'), calendar('list-other', 'reminder'), calendar('cal-work', 'event')],
    items,
  );
  const config = parseConfig({
    grants: [
      { capability: 'reminder.update', target: 'list-todo' },
      { capability: 'reminder.create', target: 'list-other' },
    ],
    defaults: { reminder: 'list-todo' },
  });
  const deps: UpdateDeps = { backend, config, now };
  return { backend, deps };
}

const stored = (backend: ReturnType<typeof setup>['backend'], uid: string) =>
  backend.store.get('list-todo')?.find((t) => t.includes(`UID:${uid}`)) ?? '';

export default async () => {
  await describe('rewriteComponent', async () => {
    await it('keeps every line it was not asked to change, byte for byte', () => {
      const out = rewriteComponent(RICH, 'VTODO', [{ name: 'PRIORITY', line: 'PRIORITY:1' }]);
      for (const line of [
        'PRODID:-//Some Other Client//EN',
        'DESCRIPTION:Call the office and ask for the long form\\, then sign it and send it b',
        ' ack before the end of the month',
        'DUE;TZID=Europe/Berlin:20261115T090000',
        'CATEGORIES:Home,Paperwork',
        'X-APPLE-SORT-ORDER:12',
        'X-REMINDER-SOURCE:mail:<m1@example.org>',
        'TRIGGER:-PT30M',
        'SUMMARY:Alarm title, not the task title',
        'END:VCALENDAR',
      ]) {
        expect(out.includes(line)).toBe(true);
      }
      expect(out.includes('PRIORITY:1')).toBe(true);
      expect(out.includes('PRIORITY:5')).toBe(false);
      // The only difference anywhere is that one line.
      const before = RICH.split('\r\n').filter((l) => l !== 'PRIORITY:5');
      const after = out.split('\r\n').filter((l) => l !== 'PRIORITY:1');
      expect(after.join('\r\n')).toBe(before.join('\r\n'));
    });

    await it('edits the properties of the component itself, never a nested VALARM', () => {
      const out = rewriteComponent(RICH, 'VTODO', [{ name: 'SUMMARY', line: 'SUMMARY:New title' }]);
      expect(out.includes('SUMMARY:New title')).toBe(true);
      expect(out.includes('SUMMARY:Alarm title, not the task title')).toBe(true);
      expect(out.includes('SUMMARY:Renew the lease')).toBe(false);
    });

    await it('appends a property the component does not have yet, before its END', () => {
      const out = rewriteComponent(RICH, 'VTODO', [
        { name: 'COMPLETED', line: 'COMPLETED:20261030T091500Z' },
      ]);
      const lines = out.split('\r\n');
      expect(lines[lines.indexOf('COMPLETED:20261030T091500Z') + 1]).toBe('END:VTODO');
    });

    await it('removes a property and folds a long replacement', () => {
      const long = `SUMMARY:${'x'.repeat(120)}`;
      const out = rewriteComponent(RICH, 'VTODO', [
        { name: 'PRIORITY', line: null },
        { name: 'SUMMARY', line: long },
      ]);
      expect(out.includes('PRIORITY:')).toBe(false);
      expect(out.includes('\r\n x')).toBe(true);
    });

    await it('refuses text that holds no such component', () => {
      let err: unknown = null;
      try {
        rewriteComponent('BEGIN:VEVENT\r\nUID:e\r\nEND:VEVENT\r\n', 'VTODO', []);
      } catch (e) {
        err = e;
      }
      expect(err instanceof InputError).toBe(true);
    });
  });

  await describe('buildReminderUpdate', async () => {
    await it('bumps SEQUENCE and restamps DTSTAMP and LAST-MODIFIED on every write', () => {
      const out = buildReminderUpdate(RICH, { summary: 'Renew it' }, now());
      expect(out.includes('SEQUENCE:4')).toBe(true);
      expect(out.includes('DTSTAMP:20261030T091500Z')).toBe(true);
      expect(out.includes('LAST-MODIFIED:20261030T091500Z')).toBe(true);
      expect(out.includes('DTSTAMP:20260101T080000Z')).toBe(false);
      // CREATED is not a write stamp and stays where it was.
      expect(out.includes('CREATED:20260101T080000Z')).toBe(true);
    });

    await it('treats an absent SEQUENCE as 0', () => {
      const out = buildReminderUpdate(vtodo('t1', ['SUMMARY:Reply']), { summary: 'Answer' }, now());
      expect(out.includes('SEQUENCE:1')).toBe(true);
    });

    await it('completes with a stamp and 100 percent, and reopens by removing both', () => {
      const done = buildReminderUpdate(RICH, { status: 'completed' }, now());
      expect(done.includes('STATUS:COMPLETED')).toBe(true);
      expect(done.includes('PERCENT-COMPLETE:100')).toBe(true);
      expect(done.includes('COMPLETED:20261030T091500Z')).toBe(true);

      const open = buildReminderUpdate(done, { status: 'needs-action' }, now());
      expect(open.includes('STATUS:NEEDS-ACTION')).toBe(true);
      expect(open.includes('COMPLETED:')).toBe(false);
      expect(open.includes('PERCENT-COMPLETE')).toBe(false);
      expect(open.includes('SEQUENCE:5')).toBe(true);
    });

    await it('cancelling drops the stamp but keeps the progress', () => {
      const part = buildReminderUpdate(RICH, { status: 'completed' }, now());
      const cancelled = buildReminderUpdate(part, { status: 'cancelled' }, now());
      expect(cancelled.includes('STATUS:CANCELLED')).toBe(true);
      expect(cancelled.includes('COMPLETED:')).toBe(false);
      expect(cancelled.includes('PERCENT-COMPLETE:100')).toBe(true);
    });

    await it('clears with an empty value, and writes a date as a DATE', () => {
      const out = buildReminderUpdate(RICH, { due: '', description: '', priority: 0 }, now());
      expect(out.includes('DUE')).toBe(false);
      expect(out.includes('DESCRIPTION')).toBe(false);
      expect(out.includes('PRIORITY')).toBe(false);
      const dated = buildReminderUpdate(RICH, { due: '2026-12-01' }, now());
      expect(dated.includes('DUE;VALUE=DATE:20261201')).toBe(true);
      expect(dated.includes('TZID=Europe/Berlin')).toBe(false);
    });

    await it('escapes text and refuses bad input', () => {
      const out = buildReminderUpdate(RICH, { description: 'one; two, three' }, now());
      expect(out.includes('DESCRIPTION:one\\; two\\, three')).toBe(true);

      const bad = (changes: Parameters<typeof buildReminderUpdate>[1]) => {
        try {
          buildReminderUpdate(RICH, changes, now());
        } catch (err) {
          return err instanceof InputError;
        }
        return false;
      };
      expect(bad({})).toBe(true);
      expect(bad({ summary: '  ' })).toBe(true);
      expect(bad({ priority: 11 })).toBe(true);
      // A local time without an offset would mean a different instant on every machine.
      expect(bad({ due: '2026-12-01T09:00:00' })).toBe(true);
    });
  });

  await describe('updateReminder', async () => {
    await it('writes to the default list and reports the task as it now reads', async () => {
      const { backend, deps } = setup({ 'list-todo': [RICH] });
      const result = await updateReminder(deps, { uid: 't-rich', summary: 'Renew it', priority: 1 });
      expect(result.calendarUid).toBe('list-todo');
      expect(result.reminder?.summary).toBe('Renew it');
      expect(result.reminder?.priority).toBe(1);
      expect(stored(backend, 't-rich').includes('SUMMARY:Renew it')).toBe(true);
      expect(stored(backend, 't-rich').includes('X-APPLE-SORT-ORDER:12')).toBe(true);
    });

    await it('completes and reopens a task through the backend', async () => {
      const { backend, deps } = setup();
      const done = await updateReminder(deps, { calendar: 'list-todo', uid: 't1', status: 'completed' });
      expect(done.reminder?.status).toBe('completed');
      expect(done.reminder?.completed).toBe('2026-10-30T09:15:00Z');
      expect(readReminder(stored(backend, 't1'), 'list-todo')?.percentComplete).toBe(100);

      const open = await updateReminder(deps, { calendar: 'list-todo', uid: 't1', status: 'needs-action' });
      expect(open.reminder?.status).toBe('needs-action');
      expect(open.reminder?.completed).toBe(null);
      expect(readReminder(stored(backend, 't1'), 'list-todo')?.percentComplete).toBe(null);
    });

    await it('refuses an ungranted list without writing', async () => {
      const { backend, deps } = setup({
        'list-todo': [vtodo('t1', ['SUMMARY:Reply'])],
        'list-other': [vtodo('t2', ['SUMMARY:Elsewhere'])],
      });
      const err = await rejection(updateReminder(deps, { calendar: 'list-other', uid: 't2', summary: 'No' }));
      expect(err instanceof GrantDeniedError).toBe(true);
      expect((err as GrantDeniedError).capability).toBe('reminder.update');
      // `reminder.create` on that list is not an update grant.
      expect(backend.calls.some((c) => c.startsWith('updateItem:'))).toBe(false);
      expect(backend.calls.some((c) => c.startsWith('getItem:'))).toBe(false);
    });

    await it('refuses a uid the list does not hold, and a list that is not enabled', async () => {
      const { deps } = setup();
      expect(
        (await rejection(updateReminder(deps, { uid: 'nope', summary: 'x' }))) instanceof ReminderError,
      ).toBe(true);
      const noList = await rejection(
        updateReminder(
          { ...deps, config: parseConfig({ grants: [{ capability: 'reminder.update', target: 'ghost' }] }) },
          { calendar: 'ghost', uid: 't1', summary: 'x' },
        ),
      );
      expect(noList instanceof ReminderError).toBe(true);
    });

    await it('reports a concurrent change as a conflict instead of overwriting it', async () => {
      const { backend, deps } = setup({ 'list-todo': [RICH] });
      const slow = {
        ...deps,
        backend: {
          ...backend,
          async getItem(calendarUid: string, kind: 'event' | 'reminder', uid: string) {
            const read = await backend.getItem(calendarUid, kind, uid);
            // Another client saves the same task between our read and our write.
            backend.tamper(calendarUid, uid, RICH.replace('PRIORITY:5', 'PRIORITY:9'));
            return read;
          },
        },
      };
      const err = await rejection(updateReminder(slow, { uid: 't-rich', summary: 'Mine' }));
      expect(err instanceof ConflictError).toBe(true);
      expect(stored(backend, 't-rich').includes('PRIORITY:9')).toBe(true);
      expect(stored(backend, 't-rich').includes('SUMMARY:Mine')).toBe(false);
    });
  });
};
