import { describe, expect, it } from '@gjsify/unit';
import {
  type BoardSourceType,
  type Card,
  classifyCard,
  classifyColumn,
  columnKey,
  type ColumnFacts,
  type ColumnOverrides,
  isTargetColumn,
  type SourceColumn,
  type TargetColumn,
} from '@reminder/core';

/** One row of a table test: a column as a source hands it over, and the lane it belongs in. */
interface Row {
  column: ColumnFacts;
  expect: TargetColumn;
}

function check(type: BoardSourceType, rows: Row[], overrides: ColumnOverrides = {}): void {
  for (const row of rows) {
    const got = classifyColumn(type, row.column, overrides);
    if (got !== row.expect)
      throw new Error(`${type}: "${row.column.name}" became ${got}, expected ${row.expect}`);
  }
}

const name = (value: string, closed: boolean | null = null): ColumnFacts => ({ name: value, closed });

const card = (sourceColumn: string, closed: boolean | null = null): Card => ({
  ref: { source: 's', board: 'b', id: 'c' },
  title: 'a card',
  sourceColumn,
  closed,
  due: null,
  assignees: [],
  watchedByMe: null,
  labels: [],
  url: null,
  version: null,
  updated: null,
});

export default async () => {
  await describe('column keys', async () => {
    await it('folds case, spacing and punctuation into one key', async () => {
      expect(columnKey('To-Do')).toBe(columnKey('TODO'));
      expect(columnKey('to do')).toBe(columnKey('To-Do'));
      expect(columnKey('  In   Progress!  ')).toBe(columnKey('in progress'));
    });

    await it('keeps letters beyond ASCII, so German names stay distinguishable', async () => {
      expect(columnKey('Zurückgestellt')).toBe('zurückgestellt');
      expect(columnKey('Erledigt') === columnKey('Offen')).toBe(false);
    });

    await it('knows which strings are target columns', async () => {
      expect(isTargetColumn('in-progress')).toBe(true);
      expect(isTargetColumn('unassigned')).toBe(true);
      expect(isTargetColumn('in progress')).toBe(false);
      expect(isTargetColumn(null)).toBe(false);
    });
  });

  await describe('default rules: deck', async () => {
    await it('places the English stack names', async () => {
      check('deck', [
        { column: name('Backlog'), expect: 'backlog' },
        { column: name('Someday'), expect: 'backlog' },
        { column: name('To Do'), expect: 'todo' },
        { column: name('Open'), expect: 'todo' },
        { column: name('Doing'), expect: 'in-progress' },
        { column: name('In Progress'), expect: 'in-progress' },
        { column: name('WIP'), expect: 'in-progress' },
        { column: name('Done'), expect: 'done' },
        { column: name('Closed'), expect: 'done' },
      ]);
    });

    await it('places the German stack names, same table', async () => {
      check('deck', [
        { column: name('Ideen'), expect: 'backlog' },
        { column: name('Irgendwann'), expect: 'backlog' },
        { column: name('Offen'), expect: 'todo' },
        { column: name('Zu erledigen'), expect: 'todo' },
        { column: name('Neu'), expect: 'todo' },
        { column: name('In Arbeit'), expect: 'in-progress' },
        { column: name('In Bearbeitung'), expect: 'in-progress' },
        { column: name('Erledigt'), expect: 'done' },
        { column: name('Fertig'), expect: 'done' },
        { column: name('Abgeschlossen'), expect: 'done' },
      ]);
    });

    await it('answers unassigned rather than guessing todo', async () => {
      check('deck', [
        { column: name('Review'), expect: 'unassigned' },
        { column: name('Wartet auf Kunde'), expect: 'unassigned' },
        { column: name('Blocked'), expect: 'unassigned' },
      ]);
    });

    await it('reads an archived stack as done whatever it is called', async () => {
      check('deck', [
        { column: name('Review', true), expect: 'done' },
        { column: name('Irgendwann', true), expect: 'done' },
      ]);
    });
  });

  await describe('default rules: zenkit', async () => {
    await it('uses the same name table in both languages', async () => {
      check('zenkit', [
        { column: name('To do'), expect: 'todo' },
        { column: name('In Arbeit'), expect: 'in-progress' },
        { column: name('Erledigt'), expect: 'done' },
        { column: name('Ideas'), expect: 'backlog' },
        { column: name('Freigabe'), expect: 'unassigned' },
      ]);
    });
  });

  await describe('default rules: openproject', async () => {
    await it('reads isClosed as the fact it is, before any name', async () => {
      check('openproject', [
        { column: { name: 'Rejected', closed: true }, expect: 'done' },
        { column: { name: 'Abgelehnt', closed: true }, expect: 'done' },
        { column: { name: 'Closed', closed: true }, expect: 'done' },
      ]);
    });

    await it('never calls an open status done, however it is named', async () => {
      check('openproject', [
        { column: { name: 'Done', closed: false }, expect: 'todo' },
        { column: { name: 'Erledigt', closed: false }, expect: 'todo' },
      ]);
    });

    await it('places every other open status in todo, including the default one', async () => {
      check('openproject', [
        { column: { name: 'New', closed: false, initial: true }, expect: 'todo' },
        { column: { name: 'Neu', closed: false, initial: true }, expect: 'todo' },
        { column: { name: 'Specified', closed: false }, expect: 'todo' },
        { column: { name: 'In Bearbeitung', closed: false }, expect: 'in-progress' },
        { column: { name: 'In progress', closed: false }, expect: 'in-progress' },
        { column: { name: 'Backlog', closed: false }, expect: 'backlog' },
      ]);
    });
  });

  await describe('default rules: vtodo', async () => {
    await it('reads STATUS, in both spellings of the dash', async () => {
      check('vtodo', [
        { column: name('NEEDS-ACTION'), expect: 'todo' },
        { column: name('needs-action'), expect: 'todo' },
        { column: name('IN-PROCESS'), expect: 'in-progress' },
        { column: name('COMPLETED'), expect: 'done' },
        { column: name('CANCELLED'), expect: 'ignore' },
      ]);
    });

    await it('treats a task with no status as open, per RFC 5545', async () => {
      check('vtodo', [{ column: { name: '' }, expect: 'todo' }]);
    });

    await it('reads PERCENT-COMPLETE only where STATUS is silent', async () => {
      check('vtodo', [
        { column: { name: '', percentComplete: 0 }, expect: 'todo' },
        { column: { name: '', percentComplete: 40 }, expect: 'in-progress' },
        { column: { name: '', percentComplete: 100 }, expect: 'done' },
      ]);
    });

    await it('lets an explicit STATUS win over a percentage that disagrees', async () => {
      check('vtodo', [
        { column: { name: 'NEEDS-ACTION', percentComplete: 100 }, expect: 'todo' },
        { column: { name: 'COMPLETED', percentComplete: 0 }, expect: 'done' },
        { column: { name: 'CANCELLED', percentComplete: 100 }, expect: 'ignore' },
      ]);
    });

    await it('places the board column a task may carry instead of a status', async () => {
      check('vtodo', [{ column: name('BACKLOG'), expect: 'backlog' }]);
    });
  });

  await describe('user overrides', async () => {
    await it('win over the name table', async () => {
      check('deck', [{ column: name('Done'), expect: 'in-progress' }], { done: 'in-progress' });
    });

    await it('win over the source own facts, by the normalised key', async () => {
      check('openproject', [{ column: { name: 'Rejected', closed: true }, expect: 'ignore' }], {
        rejected: 'ignore',
      });
      check('deck', [{ column: name('In Review', true), expect: 'todo' }], { inreview: 'todo' });
    });

    await it('place a column no default rule knows', async () => {
      check('deck', [{ column: name('Wartet auf Kunde'), expect: 'backlog' }], {
        wartetaufkunde: 'backlog',
      });
    });

    await it('leave the columns they do not name alone', async () => {
      check(
        'deck',
        [
          { column: name('Review'), expect: 'ignore' },
          { column: name('Done'), expect: 'done' },
        ],
        { review: 'ignore' },
      );
    });
  });

  await describe('classifying a card', async () => {
    const columns: SourceColumn[] = [
      { name: 'Review', position: 0, closed: false, initial: false },
      { name: 'Archive', position: 1, closed: true, initial: false },
    ];

    await it('takes the facts from the column the source listed', async () => {
      expect(classifyCard('deck', card('Archive'), columns)).toBe('done');
      expect(classifyCard('deck', card('Review'), columns)).toBe('unassigned');
    });

    await it('falls back to the card own closed flag for a column nobody listed', async () => {
      expect(classifyCard('deck', card('Later', true), [])).toBe('done');
      expect(classifyCard('deck', card('Later'), [])).toBe('unassigned');
    });

    await it('applies the overrides it is given', async () => {
      expect(classifyCard('deck', card('Review'), columns, { review: 'todo' })).toBe('todo');
    });
  });
};
