/**
 * Source columns onto the four lanes (docs/adr/0008).
 *
 * One pure module, because a mapping done in the GUI is a mapping the CLI and the MCP server do
 * not have (ADR 0004 §2). Nothing here fetches, and nothing here knows a source's wire format: it
 * takes what `BoardSource` already normalised and answers with a lane.
 *
 * Two things it refuses to do. It never guesses — a column no rule places answers `unassigned`,
 * which the view draws as its own lane, instead of quietly becoming `todo`. And it never
 * translates: the name table holds German and English at once, so a German Deck next to an English
 * OpenProject needs no configuration.
 */

import type { BoardSourceType, Card, SourceColumn } from './types.ts';

export const TARGET_COLUMNS = ['backlog', 'todo', 'in-progress', 'done', 'ignore', 'unassigned'] as const;
export type TargetColumn = (typeof TARGET_COLUMNS)[number];

/** The four the board draws, in the order it draws them. `ignore` and `unassigned` are not lanes. */
export const BOARD_LANES = ['backlog', 'todo', 'in-progress', 'done'] as const;
export type BoardLane = (typeof BOARD_LANES)[number];

export function isTargetColumn(value: unknown): value is TargetColumn {
  return typeof value === 'string' && (TARGET_COLUMNS as readonly string[]).includes(value);
}

/**
 * The key a column is matched and configured by: lower-cased with everything that is not a letter
 * or a digit removed, so `"To-Do"`, `"TODO"` and `"to do"` are one key. `toLowerCase()` is the
 * case folding — no `localeCompare`, because the table carries no locale and the stack titles on a
 * server do not change with the reader's.
 */
export function columnKey(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Source column name (by `columnKey`) to the lane a person put it in. */
export type ColumnOverrides = Record<string, TargetColumn>;

const NAMES: Record<BoardLane, string[]> = {
  backlog: ['backlog', 'ideen', 'ideas', 'someday', 'irgendwann'],
  todo: ['todo', 'to do', 'open', 'offen', 'neu', 'new', 'zu erledigen'],
  'in-progress': ['in progress', 'in arbeit', 'doing', 'wip', 'bearbeitung', 'in bearbeitung'],
  done: ['done', 'erledigt', 'fertig', 'abgeschlossen', 'closed', 'geschlossen'],
};

const BY_NAME = new Map<string, BoardLane>();
for (const lane of BOARD_LANES) for (const name of NAMES[lane]) BY_NAME.set(columnKey(name), lane);

/** VTODO `STATUS`, checked before `PERCENT-COMPLETE`: a task may carry both and disagree. */
const VTODO_STATUS: Record<string, TargetColumn> = {
  backlog: 'backlog',
  needsaction: 'todo',
  inprocess: 'in-progress',
  completed: 'done',
  cancelled: 'ignore',
};

/**
 * What a rule may read about a column. `SourceColumn` is one, so is a card's own column with the
 * card's `closed`; `percentComplete` exists for VTODO alone and is read only when `STATUS` is
 * missing.
 */
export interface ColumnFacts {
  name: string;
  closed?: boolean | null;
  initial?: boolean | null;
  percentComplete?: number | null;
}

/**
 * Facts beat names: `isClosed`, `COMPLETED` and `archived` are what the source states about
 * itself, a stack called "Fertig" is a string someone typed. So a column the source calls closed
 * is `done` whatever it is named, and a column the source calls open is never `done` — that board
 * has a lane named "Done" that it does not treat as finished, and the person's override says which
 * one they meant.
 *
 * `null` is not a fact: a source with no such notion (Deck) leaves the name to decide.
 */
function byFactsThenName(column: ColumnFacts, key: string, fallback: TargetColumn): TargetColumn {
  if (column.closed === true) return 'done';
  const name = BY_NAME.get(key);
  if (name === undefined) return fallback;
  if (name === 'done' && column.closed === false) return fallback;
  return name;
}

function classifyVtodo(column: ColumnFacts, key: string): TargetColumn {
  const status = VTODO_STATUS[key];
  if (status !== undefined) return status;
  const percent = column.percentComplete;
  if (typeof percent === 'number' && Number.isFinite(percent)) {
    if (percent >= 100) return 'done';
    return percent > 0 ? 'in-progress' : 'todo';
  }
  // No status and no percentage is RFC 5545's open task, not an unknown column.
  if (key === '') return 'todo';
  return byFactsThenName(column, key, 'unassigned');
}

/**
 * A user override wins over every default including the source's own facts: someone who says
 * "our 'Done' stack is really a waiting lane" knows their board better than this table does.
 */
export function classifyColumn(
  type: BoardSourceType,
  column: ColumnFacts,
  overrides: ColumnOverrides = {},
): TargetColumn {
  const key = columnKey(column.name);
  const override = overrides[key];
  if (override !== undefined) return override;
  switch (type) {
    case 'vtodo':
      return classifyVtodo(column, key);
    // Every OpenProject status that is not closed is something open to do, so there is no
    // unassigned column here: `isDefault` and every other open status land in `todo`.
    case 'openproject':
      return byFactsThenName(column, key, 'todo');
    case 'deck':
    case 'zenkit':
      return byFactsThenName(column, key, 'unassigned');
  }
}

/**
 * The lane a card is drawn in. `columns` is what `listColumns` answered; a card whose column is
 * not among them is still classified by its own name, because refusing here would hide the card.
 * The card keeps showing `sourceColumn` either way (ADR 0008 §6).
 */
export function classifyCard(
  type: BoardSourceType,
  card: Card,
  columns: readonly SourceColumn[] = [],
  overrides: ColumnOverrides = {},
): TargetColumn {
  const column = columns.find((entry) => columnKey(entry.name) === columnKey(card.sourceColumn));
  return classifyColumn(
    type,
    {
      name: card.sourceColumn,
      closed: column?.closed ?? card.closed ?? null,
      initial: column?.initial ?? null,
    },
    overrides,
  );
}
