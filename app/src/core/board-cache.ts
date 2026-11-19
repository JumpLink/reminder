/**
 * How a board lives in the sync cache (docs/adr/0010, 0017): under its own key space, with the
 * columns and cards of one read as the body.
 *
 * The key space matters. A VTODO board source is named after its account and its boards are named
 * after the task lists, so `{account: 'home', source: 'tasks'}` would be the key the task-list
 * sync already writes its iCalendar collection to — two formats, one file. An account id can hold
 * no colon (ADR 0005), so the prefix below can collide with nothing.
 *
 * The body is JSON, and reading it back trusts nothing: the cache is derived data on disk, and a
 * file that does not decode is a miss, never an error (ADR 0010 §3).
 */

import type { Card, CacheKey, CardLabel, SourceColumn, SourceUser } from '@reminder/core';

/** Prefixes the account part of a board's cache key. */
export const BOARD_CACHE_PREFIX = 'board:';

export function boardCacheKey(source: string, board: string): CacheKey {
  return { account: `${BOARD_CACHE_PREFIX}${source}`, source: board };
}

export function isBoardCacheKey(key: CacheKey): boolean {
  return key.account.startsWith(BOARD_CACHE_PREFIX);
}

/** The `SourceInfo.id` a board cache key belongs to, or null when it is not one. */
export function boardSourceOfCacheKey(key: CacheKey): string | null {
  return isBoardCacheKey(key) ? key.account.slice(BOARD_CACHE_PREFIX.length) : null;
}

/** One read of one board: what `listColumns` and `listCards` answered together. */
export interface BoardBody {
  columns: SourceColumn[];
  cards: Card[];
}

export function encodeBoardBody(body: BoardBody): string {
  return JSON.stringify({ columns: body.columns, cards: body.cards });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** A field the sources may leave out: a string or null, and nothing else. */
const maybeText = (value: unknown): string | null | undefined =>
  value === null || typeof value === 'string' ? value : undefined;

const maybeFlag = (value: unknown): boolean | null | undefined =>
  value === null || typeof value === 'boolean' ? value : undefined;

const maybeNumber = (value: unknown): number | null | undefined =>
  value === null || (typeof value === 'number' && Number.isFinite(value)) ? value : undefined;

function readColumn(raw: unknown): SourceColumn | null {
  if (!isRecord(raw)) return null;
  const name = text(raw.name);
  const position = maybeNumber(raw.position);
  const closed = maybeFlag(raw.closed);
  const initial = maybeFlag(raw.initial);
  if (name === null || position === undefined || closed === undefined || initial === undefined) return null;
  return { name, position, closed, initial };
}

function readUser(raw: unknown): SourceUser | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id);
  const displayName = maybeText(raw.displayName);
  if (id === null || displayName === undefined || typeof raw.isMe !== 'boolean') return null;
  return { id, displayName, isMe: raw.isMe };
}

function readLabel(raw: unknown): CardLabel | null {
  if (!isRecord(raw)) return null;
  const name = text(raw.name);
  const color = maybeText(raw.color);
  if (name === null || color === undefined) return null;
  return { name, color };
}

function readList<T>(raw: unknown, read: (entry: unknown) => T | null): T[] | null {
  if (!Array.isArray(raw)) return null;
  const out: T[] = [];
  for (const entry of raw) {
    const parsed = read(entry);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
}

function readCard(raw: unknown): Card | null {
  if (!isRecord(raw) || !isRecord(raw.ref)) return null;
  const source = text(raw.ref.source);
  const board = text(raw.ref.board);
  const id = text(raw.ref.id);
  const title = text(raw.title);
  const sourceColumn = text(raw.sourceColumn);
  const closed = maybeFlag(raw.closed);
  const due = maybeText(raw.due);
  const watchedByMe = maybeFlag(raw.watchedByMe);
  const url = maybeText(raw.url);
  const version = maybeText(raw.version);
  const updated = maybeText(raw.updated);
  const assignees = readList(raw.assignees, readUser);
  const labels = readList(raw.labels, readLabel);
  if (source === null || board === null || id === null || title === null || sourceColumn === null)
    return null;
  if (closed === undefined || due === undefined || watchedByMe === undefined) return null;
  if (url === undefined || version === undefined || updated === undefined) return null;
  if (assignees === null || labels === null) return null;
  return {
    ref: { source, board, id },
    title,
    sourceColumn,
    closed,
    due,
    assignees,
    watchedByMe,
    labels,
    url,
    version,
    updated,
  };
}

/** The columns and cards a cached body holds, or null when it is not one. */
export function decodeBoardBody(body: string): BoardBody | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const columns = readList(parsed.columns, readColumn);
  const cards = readList(parsed.cards, readCard);
  if (columns === null || cards === null) return null;
  return { columns, cards };
}
