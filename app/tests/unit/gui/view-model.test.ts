import { describe, expect, it } from '@gjsify/unit';
import type { CalendarInfo, ReminderItem } from '@reminder/core';

import {
  buildSourceSections,
  buildVisibleAgenda,
  colourFor,
  describeSyncProblems,
  dueDate,
  overviewContainerFor,
  toRowData,
} from '../../../src/frontends/gui/view-model.ts';

const cal = (uid: string, kind: 'event' | 'reminder', name = uid): CalendarInfo => ({
  uid,
  name,
  kind,
  backend: 'fake',
  account: null,
});

function task(uid: string, calendarUid: string, extra: Partial<ReminderItem> = {}): ReminderItem {
  return {
    uid,
    calendarUid,
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

export default async () => {
  await describe('overview container', async () => {
    await it('is a sheet while compact, an overlay while medium and docked while wide', async () => {
      expect(overviewContainerFor('compact')).toBe('bottom-sheet');
      expect(overviewContainerFor('medium')).toBe('overlay');
      expect(overviewContainerFor('wide')).toBe('docked');
    });
  });

  await describe('source sections', async () => {
    const calendars = [cal('c1', 'event'), cal('t1', 'reminder'), cal('t2', 'reminder')];

    await it('splits calendars from task lists and leaves empty sections out', async () => {
      const sections = buildSourceSections(calendars, new Set());
      expect(sections.length).toBe(2);
      expect(sections[0].sources.length).toBe(1);
      expect(sections[1].sources.map((s) => s.id).join(',')).toBe('t1,t2');
      expect(buildSourceSections([cal('t1', 'reminder')], new Set()).length).toBe(1);
    });

    await it('marks hidden sources as not visible', async () => {
      const sections = buildSourceSections(calendars, new Set(['t2']));
      expect(sections[1].sources.map((s) => s.visible).join(',')).toBe('true,false');
    });

    await it('gives a source the same colour on every run', async () => {
      expect(colourFor('t1')).toBe(colourFor('t1'));
      expect(/^#[0-9a-f]{6}$/.test(colourFor('anything'))).toBe(true);
    });
  });

  await describe('hidden is a view filter', async () => {
    await it('drops the tasks of hidden lists from the agenda only', async () => {
      const all = [task('a', 't1'), task('b', 't2')];
      const agenda = buildVisibleAgenda(all, new Set(['t2']), new Date(2026, 10, 18));
      expect(agenda.sections[0].items.map((i) => i.uid).join(',')).toBe('a');
      expect(all.length).toBe(2);
    });
  });

  await describe('rows', async () => {
    await it('reads a bare due date as that local day', async () => {
      const d = dueDate(task('a', 't', { due: '2026-11-18' }));
      expect(d?.getDate()).toBe(18);
      expect(d?.getHours()).toBe(0);
      expect(dueDate(task('a', 't'))).toBe(null);
      expect(dueDate(task('a', 't', { due: 'nonsense' }))).toBe(null);
    });

    await it('marks finished tasks as done and names untitled ones', async () => {
      const row = toRowData(task('a', 't', { status: 'completed', summary: null }), {
        name: 'L',
        colour: '#fff',
      });
      expect(row.done).toBe(true);
      expect(row.title.length > 0).toBe(true);
    });
  });

  await describe('sync problems', async () => {
    await it('is silent while sources are current or loading', async () => {
      const ok = { state: { kind: 'current' } as const, lastSuccessAt: null };
      expect(
        describeSyncProblems([
          { name: 'A', status: ok },
          { name: 'B', status: null },
        ]),
      ).toBe(null);
    });

    await it('names the sources that are not up to date', async () => {
      const bad = { state: { kind: 'auth-rejected' } as const, lastSuccessAt: null };
      const text = describeSyncProblems([{ name: 'Work', status: bad }]) ?? '';
      expect(text.includes('Work')).toBe(true);
    });
  });
};
