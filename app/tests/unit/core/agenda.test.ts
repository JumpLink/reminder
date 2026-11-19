import { describe, expect, it } from '@gjsify/unit';
import { buildAgenda, dueDayNumber, type ReminderItem } from '@reminder/core';

// Local time on purpose: sections are calendar days of the reader's zone.
const NOW = new Date(2026, 10, 18, 14, 30);

function task(uid: string, extra: Partial<ReminderItem> = {}): ReminderItem {
  return {
    uid,
    calendarUid: 'list',
    summary: uid,
    description: null,
    due: null,
    dueAllDay: false,
    completed: null,
    status: 'needs-action',
    priority: null,
    percentComplete: null,
    recurring: false,
    source: null,
    created: null,
    url: null,
    parent: null,
    ...extra,
  };
}

const ids = (items: ReminderItem[]) => items.map((i) => i.uid);

export default async () => {
  await describe('buildAgenda', async () => {
    await it('groups open tasks by due day in a fixed section order', async () => {
      const agenda = buildAgenda(
        [
          task('none'),
          task('later', { due: '2026-12-01' }),
          task('upcoming', { due: '2026-11-25', dueAllDay: true }),
          task('today-late', { due: '2026-11-18T23:30:00' }),
          task('overdue', { due: '2026-11-17' }),
        ],
        NOW,
      );
      expect(agenda.sections.map((s) => s.id).join(',')).toBe('overdue,today,upcoming,later,none');
      expect(agenda.completed.length).toBe(0);
    });

    await it('ends "upcoming" after seven days', async () => {
      const agenda = buildAgenda([task('a', { due: '2026-11-25' }), task('b', { due: '2026-11-26' })], NOW);
      expect(ids(agenda.sections[0].items).join(',')).toBe('a');
      expect(agenda.sections[0].id).toBe('upcoming');
      expect(agenda.sections[1].id).toBe('later');
    });

    await it('omits empty sections', async () => {
      const agenda = buildAgenda([task('x')], NOW);
      expect(agenda.sections.length).toBe(1);
      expect(agenda.sections[0].id).toBe('none');
    });

    await it("moves an instant to the reader's day", async () => {
      const noon = new Date(2026, 10, 18, 12, 0).toISOString();
      expect(dueDayNumber(noon)).toBe(dueDayNumber('2026-11-18'));
      expect(dueDayNumber('2026-11-18T09:00:00')).toBe(dueDayNumber('2026-11-18'));
      expect(dueDayNumber('nonsense')).toBe(null);
      expect(dueDayNumber(null)).toBe(null);
    });

    await it('sorts by due, then priority, then title, then uid — by code unit', async () => {
      const agenda = buildAgenda(
        [
          task('u3', { due: '2026-11-18', summary: 'b' }),
          task('u2', { due: '2026-11-18', summary: 'B' }),
          task('u1', { due: '2026-11-18', summary: 'z', priority: 1 }),
          task('u0', { due: '2026-11-18T08:00:00', summary: 'z', priority: 5 }),
          task('u4', { due: '2026-11-18', summary: 'b' }),
        ],
        NOW,
      );
      // Same day: "2026-11-18" < "2026-11-18T08:00:00"; then priority; "B" before "b".
      expect(ids(agenda.sections[0].items).join(',')).toBe('u1,u2,u3,u4,u0');
    });

    await it('puts undated tasks last within the none section by title', async () => {
      const agenda = buildAgenda([task('2', { summary: 'beta' }), task('1', { summary: 'alpha' })], NOW);
      expect(ids(agenda.sections[0].items).join(',')).toBe('1,2');
    });

    await it('keeps finished tasks apart, newest first', async () => {
      const agenda = buildAgenda(
        [
          task('old', { status: 'completed', completed: '2026-11-01T10:00:00Z', due: '2026-11-01' }),
          task('new', { status: 'completed', completed: '2026-11-17T10:00:00Z' }),
          task('gone', { status: 'cancelled' }),
          task('open', { due: '2026-11-18' }),
        ],
        NOW,
      );
      expect(ids(agenda.completed).join(',')).toBe('new,old,gone');
      expect(agenda.sections.length).toBe(1);
    });

    await it('is stable for the same input in any order', async () => {
      const items = [task('a', { due: '2026-11-18' }), task('b', { due: '2026-11-18' }), task('c')];
      const forward = buildAgenda(items, NOW);
      const backward = buildAgenda([...items].reverse(), NOW);
      expect(JSON.stringify(forward)).toBe(JSON.stringify(backward));
    });
  });
};
