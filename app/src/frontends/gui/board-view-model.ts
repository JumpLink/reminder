/**
 * What the board shows, decided without Gtk so it runs under Node tests: the four lanes plus the
 * unsorted one, the filter chips above them, and which of loading / empty / failed the view is in.
 * The widgets only paint what this returns.
 *
 * Grouping is `classifyCard` from the core (ADR 0008), not a second rule here — the CLI and the
 * MCP server must put a card in the same lane this does. What IS decided here is presentation:
 * the lane titles, the 14-day window of the done lane (plan §6.6), the initials on an avatar and
 * the order within a lane.
 */

import {
  _,
  BOARD_LANES,
  classifyCard,
  DEFAULT_MINE,
  fmt,
  matchesMine,
  type BoardRef,
  type BoardSourceType,
  type Card,
  type CardRef,
  type ColumnOverrides,
  type MineFilter,
  type SourceColumn,
  type SourceUser,
  type TargetColumn,
} from '@reminder/core';
import type { BoardCardData, BoardColumnData } from '@gjsify/adwaita-extended';

import { colourFor } from './view-model.ts';

/** How far back the done lane looks. Older cards are still in their source, just not drawn. */
export const DONE_WINDOW_DAYS = 14;

/** The lanes the view draws: the four of the core, and the unsorted one behind them (ADR 0008 §1). */
export const BOARD_VIEW_LANES = [...BOARD_LANES, 'unassigned'] as const satisfies readonly TargetColumn[];
export type BoardViewLane = (typeof BOARD_VIEW_LANES)[number];

/** One board as it arrived: what the source answered, plus what the configuration says about it. */
export interface LoadedBoard {
  /** `SourceInfo.id` — the source this board came from. */
  source: string;
  type: BoardSourceType;
  board: BoardRef;
  columns: readonly SourceColumn[];
  cards: readonly Card[];
  /** The person's lane overrides for this board (`overridesFor`). */
  overrides: ColumnOverrides;
  /** False: no card of this board gets a drag grip (Phase 4). */
  writable: boolean;
}

/** One source that could not be read. Its cards are missing, the others are still drawn (ADR 0017). */
export interface BoardProblem {
  source: string;
  /** What to call the source in a message — its board's title, or its id. */
  label: string;
  message: string;
}

export interface BoardSnapshot {
  boards: readonly LoadedBoard[];
  problems: readonly BoardProblem[];
  /** True until every source has answered once. */
  loading: boolean;
  /** No source is configured at all — a different thing from "no cards". */
  configured: boolean;
}

export function emptyBoardSnapshot(): BoardSnapshot {
  return { boards: [], problems: [], loading: true, configured: false };
}

export interface BoardFilters {
  /** `SourceInfo.id`s to show. Empty means every source. */
  sources: readonly string[];
  mine: MineFilter;
  /** The done lane is part of the layout, so this starts on; off drops the lane. */
  includeDone: boolean;
}

export const DEFAULT_BOARD_FILTERS: BoardFilters = {
  sources: [],
  mine: DEFAULT_MINE,
  includeDone: true,
};

/** The id a card travels under between the widget and this module. */
export function cardKey(ref: CardRef): string {
  return `${ref.source}\n${ref.board}\n${ref.id}`;
}

export function laneTitle(lane: BoardViewLane): string {
  switch (lane) {
    case 'backlog':
      return _('Backlog');
    case 'todo':
      return _('To do');
    case 'in-progress':
      return _('In progress');
    case 'done':
      return _('Done');
    case 'unassigned':
      return _('Unsorted');
  }
}

/**
 * The initials on the avatar. Letters only, from at most the first two words of what the source
 * calls the person; an id like `alex@example.org` is split the same way, so a source that answers
 * no display name still shows something.
 */
export function initialsOf(user: SourceUser): string {
  const parts = (user.displayName ?? user.id).split(/[^\p{L}\p{N}]+/u).filter((part) => part !== '');
  if (parts.length === 0) return '?';
  const letters = [[...parts[0]][0] ?? '', parts.length > 1 ? ([...parts[1]][0] ?? '') : ''];
  return letters.join('').toUpperCase();
}

/** Own avatar first (plan §6.6), the rest in the order the source listed them. */
export function avatarsOf(card: Pick<Card, 'assignees'>): string[] {
  const own = card.assignees.filter((user) => user.isMe);
  const others = card.assignees.filter((user) => !user.isMe);
  return [...own, ...others].map(initialsOf);
}

/** A due string as a local `Date`: a bare date is that day here, not UTC midnight. */
export function boardDueDate(due: string | null): Date | null {
  if (due === null) return null;
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due);
  const date = bare ? new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3])) : new Date(due);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A colour per board, so two lists of the same account are told apart. */
export function boardColour(board: Pick<LoadedBoard, 'source' | 'board'>): string {
  return colourFor(`${board.source}:${board.board.id}`);
}

/**
 * The lock a read-only card carries says "this one you cannot move, the others you can" — it is
 * only worth drawing where the board holds both kinds. While nothing is writable (the board is
 * read-only until Phase 4, ADR 0007 §3) a lock on every card marks no difference, so it stays off.
 */
export function marksReadOnly(boards: readonly LoadedBoard[]): boolean {
  return boards.some((board) => board.writable);
}

export function toBoardCard(card: Card, board: LoadedBoard, markReadOnly = true): BoardCardData {
  return {
    id: cardKey(card.ref),
    title: card.title === '' ? _('Untitled') : card.title,
    sourceLabel: board.board.title,
    sourceColour: boardColour(board),
    assignees: avatarsOf(card),
    labels: card.labels.map((label) => label.name),
    due: boardDueDate(card.due),
    readOnly: markReadOnly && !board.writable,
  };
}

/** What the detail pane shows. No description or comments: the card does not carry them (ADR 0007). */
export interface BoardCardDetail {
  key: string;
  title: string;
  /** The board, as the card's source mark names it. */
  sourceLabel: string;
  colour: string;
  /** The column verbatim — what the source calls it. */
  sourceColumn: string;
  lane: BoardViewLane;
  laneTitle: string;
  due: Date | null;
  /** Display names, own first; the id where the source answered no name. */
  assignees: string[];
  labels: string[];
  /** Null for a source with no page of its own: no "Open in original" then (ADR 0007 §6). */
  url: string | null;
}

/** The card a key belongs to, with the board it came from — the detail pane's lookup. */
export function findBoardCard(
  snapshot: BoardSnapshot,
  key: string,
): { card: Card; board: LoadedBoard } | null {
  for (const board of snapshot.boards) {
    const card = board.cards.find((entry) => cardKey(entry.ref) === key);
    if (card) return { card, board };
  }
  return null;
}

export function boardCardDetail(card: Card, board: LoadedBoard): BoardCardDetail {
  const lane = laneOf(card, board) ?? 'unassigned';
  const own = card.assignees.filter((user) => user.isMe);
  const others = card.assignees.filter((user) => !user.isMe);
  return {
    key: cardKey(card.ref),
    title: card.title === '' ? _('Untitled') : card.title,
    sourceLabel: board.board.title,
    colour: boardColour(board),
    sourceColumn: card.sourceColumn,
    lane,
    laneTitle: laneTitle(lane),
    due: boardDueDate(card.due),
    assignees: [...own, ...others].map((user) => user.displayName ?? user.id),
    labels: card.labels.map((label) => label.name),
    url: card.url,
  };
}

/** Null for a card the board does not draw at all: a cancelled VTODO (ADR 0008 §1). */
export function laneOf(card: Card, board: LoadedBoard): BoardViewLane | null {
  const target = classifyCard(board.type, card, board.columns, board.overrides);
  if (target === 'ignore') return null;
  return target;
}

/** Due date first (a card with none sorts last), then the title by code unit. */
function compareCards(a: BoardCardData, b: BoardCardData): number {
  const left = a.due?.getTime() ?? Number.POSITIVE_INFINITY;
  const right = b.due?.getTime() ?? Number.POSITIVE_INFINITY;
  if (left !== right) return left - right;
  return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
}

function withinDoneWindow(card: Card, now: Date): boolean {
  // No timestamp is no reason to hide a card — the window drops what is provably old, nothing else.
  if (card.updated === null) return true;
  const changed = new Date(card.updated);
  if (Number.isNaN(changed.getTime())) return true;
  return now.getTime() - changed.getTime() <= DONE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

export function showsSource(filters: BoardFilters, source: string): boolean {
  return filters.sources.length === 0 || filters.sources.includes(source);
}

/**
 * The lanes, in the order the board draws them: the four of the core, then the unsorted one. A
 * lane with no cards is still drawn — a kanban board with a column missing reads as "this column
 * does not exist" — except `unassigned`, which only appears when something landed in it, and
 * `done`, which the filter can switch off.
 */
export function buildBoardColumns(
  snapshot: BoardSnapshot,
  filters: BoardFilters = DEFAULT_BOARD_FILTERS,
  now: Date = new Date(),
): BoardColumnData[] {
  const byLane = new Map<BoardViewLane, BoardCardData[]>(BOARD_VIEW_LANES.map((lane) => [lane, []]));
  const marks = marksReadOnly(snapshot.boards);
  for (const board of snapshot.boards) {
    if (!showsSource(filters, board.source)) continue;
    for (const card of board.cards) {
      if (!matchesMine(card, filters.mine)) continue;
      const lane = laneOf(card, board);
      if (lane === null) continue;
      if (lane === 'done' && (!filters.includeDone || !withinDoneWindow(card, now))) continue;
      byLane.get(lane)?.push(toBoardCard(card, board, marks));
    }
  }
  const columns: BoardColumnData[] = [];
  for (const lane of BOARD_VIEW_LANES) {
    const cards = (byLane.get(lane) ?? []).sort(compareCards);
    if (lane === 'done' && !filters.includeDone) continue;
    if (lane === 'unassigned' && cards.length === 0) continue;
    columns.push({ id: lane, title: laneTitle(lane), cards });
  }
  return columns;
}

/** The sources the filter popover offers, in the order their boards arrived. */
export function boardSourceOptions(snapshot: BoardSnapshot): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const board of snapshot.boards) if (!seen.has(board.source)) seen.set(board.source, board.board.title);
  for (const problem of snapshot.problems)
    if (!seen.has(problem.source)) seen.set(problem.source, problem.label);
  return [...seen].map(([id, name]) => ({ id, name }));
}

export type BoardChipKey = { kind: 'source'; id: string } | { kind: 'mine' } | { kind: 'done' };

export interface BoardChip {
  key: BoardChipKey;
  label: string;
}

export function mineLabel(mine: MineFilter): string {
  switch (mine) {
    case 'assigned':
      return _('Assigned to me');
    case 'watching':
      return _('I am watching');
    case 'all':
      return _('Everyone');
  }
}

/**
 * The chips above the board: one per narrowing in force, removable. "Assigned to me" is the
 * default and still gets a chip — it is the reason a board can look emptier than it is, so it
 * stays visible rather than hiding in a popover.
 */
export function activeBoardChips(snapshot: BoardSnapshot, filters: BoardFilters): BoardChip[] {
  const chips: BoardChip[] = [];
  const names = new Map(boardSourceOptions(snapshot).map((option) => [option.id, option.name]));
  for (const id of filters.sources) chips.push({ key: { kind: 'source', id }, label: names.get(id) ?? id });
  if (filters.mine !== 'all') chips.push({ key: { kind: 'mine' }, label: mineLabel(filters.mine) });
  if (!filters.includeDone) chips.push({ key: { kind: 'done' }, label: _('Without done') });
  return chips;
}

/** Removing a chip widens: no source selection, everyone's cards, the done lane back. */
export function withoutBoardChip(filters: BoardFilters, key: BoardChipKey): BoardFilters {
  switch (key.kind) {
    case 'source':
      return { ...filters, sources: filters.sources.filter((id) => id !== key.id) };
    case 'mine':
      return { ...filters, mine: 'all' };
    case 'done':
      return { ...filters, includeDone: true };
  }
}

export type BoardStatus =
  /** Nothing has answered yet. */
  | { kind: 'loading' }
  /** No board source is configured — the empty state explains how to connect one. */
  | { kind: 'unconfigured' }
  /** Every source failed; there is nothing to show next to the message. */
  | { kind: 'failed'; message: string }
  /** Sources answered, but no card passes the filters. */
  | { kind: 'empty' }
  | { kind: 'cards' };

/**
 * Which of the states the view is in. A source that failed while others answered is NOT a state:
 * its cards are missing and the banner says so, and the board keeps drawing what it has
 * (ADR 0017 §5).
 */
export function boardStatus(snapshot: BoardSnapshot, columns: readonly BoardColumnData[]): BoardStatus {
  const cards = columns.reduce((total, column) => total + column.cards.length, 0);
  if (cards > 0) return { kind: 'cards' };
  if (snapshot.loading) return { kind: 'loading' };
  if (!snapshot.configured) return { kind: 'unconfigured' };
  if (snapshot.boards.length === 0 && snapshot.problems.length > 0)
    return { kind: 'failed', message: describeBoardProblems(snapshot.problems) ?? '' };
  return { kind: 'empty' };
}

/** The banner line over a board that is missing a source. Null when every source answered. */
export function describeBoardProblems(problems: readonly BoardProblem[]): string | null {
  if (problems.length === 0) return null;
  const parts = problems.map((problem) => `${problem.label}: ${problem.message}`);
  return fmt(_('Some boards are missing — {sources}'), { sources: parts.join(', ') });
}
