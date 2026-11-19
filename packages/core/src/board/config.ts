/**
 * The board section of the configuration file (docs/adr/0008 §4 and §5).
 *
 * Two things a person decides about a board, and both have to be in the file rather than in one
 * frontend: which lane their own columns belong to, and whose cards they want to see. A mapping
 * made in the GUI is a mapping the CLI and the MCP server do not have.
 *
 * ```jsonc
 * "boards": {
 *   "mine": "assigned",                            // the default for every source
 *   "sources": { "work": { "mine": "watching" } }, // and the exceptions
 *   "columns": { "work:42": { "Wartet": "backlog" } }
 * }
 * ```
 *
 * Column keys are kept **verbatim**: the file says what the person typed, and the normalisation of
 * `columnKey` happens when the overrides are handed to the rules. An unknown lane or an unknown
 * filter is a `ConfigError` at load, never a line that is quietly ignored.
 */

import { ConfigError } from '../errors.ts';
import { _, fmt } from '../i18n.ts';
import { DEFAULT_MINE, isMineFilter } from './mine.ts';
import { columnKey, isTargetColumn, TARGET_COLUMNS, type ColumnOverrides } from './rules.ts';
import { MINE_FILTERS, type BoardRef, type MineFilter } from './types.ts';

/** What one source may say for itself. An absent `mine` means the section's default. */
export interface BoardSourceConfig {
  mine?: MineFilter;
}

export interface BoardsConfig {
  /** Whose cards a board shows unless a source says otherwise. */
  mine: MineFilter;
  /** By `SourceInfo.id`. */
  sources: Record<string, BoardSourceConfig>;
  /** By `<source>:<board>`, then by the column name as the source spells it. */
  columns: Record<string, Record<string, string>>;
}

export function emptyBoardsConfig(): BoardsConfig {
  return { mine: DEFAULT_MINE, sources: {}, columns: {} };
}

/** The key `columns` is written under: the same `<account>:<uid>` shape a target has. */
export function boardConfigKey(board: Pick<BoardRef, 'source' | 'id'>): string {
  return `${board.source}:${board.id}`;
}

function parseMine(value: unknown, where: string): MineFilter {
  if (!isMineFilter(value)) {
    throw new ConfigError(
      fmt(_('{where} must be one of {known}'), { where, known: MINE_FILTERS.join(', ') }),
    );
  }
  return value;
}

function object(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ConfigError(fmt(_('{where} must be an object'), { where }));
  return value as Record<string, unknown>;
}

function parseSources(value: unknown): Record<string, BoardSourceConfig> {
  if (value === undefined) return {};
  const out: Record<string, BoardSourceConfig> = {};
  for (const [id, entry] of Object.entries(object(value, 'boards.sources'))) {
    const record = object(entry, `boards.sources.${id}`);
    for (const key of Object.keys(record)) {
      if (key !== 'mine')
        throw new ConfigError(fmt(_('boards.sources.{id}: unknown key "{key}"'), { id, key }));
    }
    out[id] = record.mine === undefined ? {} : { mine: parseMine(record.mine, `boards.sources.${id}.mine`) };
  }
  return out;
}

function parseColumns(value: unknown): Record<string, Record<string, string>> {
  if (value === undefined) return {};
  const out: Record<string, Record<string, string>> = {};
  for (const [board, entry] of Object.entries(object(value, 'boards.columns'))) {
    const record = object(entry, `boards.columns["${board}"]`);
    const columns: Record<string, string> = {};
    for (const [column, target] of Object.entries(record)) {
      if (!isTargetColumn(target)) {
        throw new ConfigError(
          fmt(_('boards.columns["{board}"]["{column}"]: unknown column "{target}" (known: {known})'), {
            board,
            column,
            target: typeof target === 'string' ? target : JSON.stringify(target),
            known: TARGET_COLUMNS.join(', '),
          }),
        );
      }
      columns[column] = target;
    }
    out[board] = columns;
  }
  return out;
}

export function parseBoards(value: unknown): BoardsConfig {
  if (value === undefined) return emptyBoardsConfig();
  const record = object(value, 'boards');
  for (const key of Object.keys(record)) {
    if (key !== 'mine' && key !== 'sources' && key !== 'columns')
      throw new ConfigError(fmt(_('boards: unknown key "{key}"'), { key }));
  }
  return {
    mine: record.mine === undefined ? DEFAULT_MINE : parseMine(record.mine, 'boards.mine'),
    sources: parseSources(record.sources),
    columns: parseColumns(record.columns),
  };
}

/** Nothing configured is not written back, so a file that never named a board stays as it was. */
export function serializeBoards(config: BoardsConfig): Record<string, unknown> | undefined {
  const mine = config.mine === DEFAULT_MINE ? {} : { mine: config.mine };
  const sources = Object.keys(config.sources).length > 0 ? { sources: config.sources } : {};
  const columns = Object.keys(config.columns).length > 0 ? { columns: config.columns } : {};
  const out = { ...mine, ...sources, ...columns };
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Whose cards this source shows: its own answer, else the section's, else `assigned`. */
export function mineFor(config: BoardsConfig, source: string): MineFilter {
  return config.sources[source]?.mine ?? config.mine;
}

/**
 * The overrides for one board, keyed the way `classifyColumn` matches: the file keeps the column
 * as the person wrote it, `columnKey` folds case and punctuation here.
 */
export function overridesFor(config: BoardsConfig, board: Pick<BoardRef, 'source' | 'id'>): ColumnOverrides {
  const configured = config.columns[boardConfigKey(board)];
  if (!configured) return {};
  const out: ColumnOverrides = {};
  for (const [column, target] of Object.entries(configured))
    if (isTargetColumn(target)) out[columnKey(column)] = target;
  return out;
}
