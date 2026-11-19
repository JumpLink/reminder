/**
 * The read-only view of the boards that the CLI and the MCP server share: which boards exist and
 * which cards one of them holds, as plain rows with the lane already decided.
 *
 * Sources come from `createBoardSources` (docs/adr/0007), so every ENABLED source is served and a
 * disabled one never loads (docs/adr/0006 §4). "Hidden" is the window's filter and is not read
 * here — hiding is no privacy control. Rows carry no description, no comment, no credential.
 */

import {
  _,
  BOARD_LIMIT,
  CARD_LIMIT,
  capLimit,
  classifyCard,
  ConfigError,
  fmt,
  InputError,
  mineFor,
  overridesFor,
  type BoardRef,
  type CalendarBackend,
  type MineFilter,
  type TargetColumn,
} from '@reminder/core';

import { createBoardSources, type BoardSourceEntry } from './board-sources.ts';
import { createAccountBackend, resolveSecretPasswords, type Context } from './context.ts';

export interface BoardRow {
  source: string;
  type: string;
  id: string;
  title: string;
  url: string | null;
}

export interface BoardsResult {
  boards: BoardRow[];
  /** How many boards matched beyond the limit. */
  omitted: number;
}

export interface CardRow {
  id: string;
  title: string;
  lane: TargetColumn;
  /** The column as the source names it. */
  column: string;
  assignees: string[];
  due: string | null;
  url: string | null;
}

export interface CardsResult {
  board: BoardRow;
  cards: CardRow[];
  /** How many cards matched beyond the limit. */
  omitted: number;
}

export interface CardsParams {
  /** The board id from `boards_list`. */
  board: string;
  /** Only needed when two sources have a board with that id. */
  source?: string;
  /** Default: the configuration's filter for that source. */
  mine?: MineFilter;
  includeDone?: boolean;
  limit?: number;
}

/** UTF-16 code-unit order: the same on GJS and Node, whatever the locale. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const LANE_ORDER: readonly TargetColumn[] = [
  'backlog',
  'todo',
  'in-progress',
  'done',
  'unassigned',
  'ignore',
];

/** A broken account fails the whole read (docs/adr/0005): a partial list reads as the full one. */
async function boardEntries(context: Context): Promise<BoardSourceEntry[]> {
  const config = context.config();
  const several = config.accounts.length > 1;
  const passwords =
    context.accountBackend === undefined && several
      ? await resolveSecretPasswords(config, context.secrets())
      : new Map<string, string>();
  const set = createBoardSources({
    config,
    backend: (account): CalendarBackend =>
      context.accountBackend?.(account) ??
      (several ? createAccountBackend(account, process.env, true, passwords) : context.backend()),
    identity: context.boardIdentity?.(),
  });
  if (set.problems.length > 0) {
    throw new ConfigError(fmt(_('boards cannot be read: {problems}'), { problems: set.problems.join('; ') }));
  }
  return [...set.sources, ...(context.extraBoardSources?.() ?? [])];
}

function rowOf(type: string, ref: BoardRef): BoardRow {
  return { source: ref.source, type, id: ref.id, title: ref.title, url: ref.url };
}

async function allBoards(entries: BoardSourceEntry[]): Promise<{ entry: BoardSourceEntry; ref: BoardRef }[]> {
  const found: { entry: BoardSourceEntry; ref: BoardRef }[] = [];
  for (const entry of entries) for (const ref of await entry.source.listBoards()) found.push({ entry, ref });
  return found.sort((a, b) => compare(a.ref.source, b.ref.source) || compare(a.ref.id, b.ref.id));
}

export async function listBoards(context: Context, params: { limit?: number } = {}): Promise<BoardsResult> {
  const all = await allBoards(await boardEntries(context));
  const limit = capLimit(params.limit, BOARD_LIMIT);
  return {
    boards: all.slice(0, limit).map(({ entry, ref }) => rowOf(entry.info.type, ref)),
    omitted: Math.max(0, all.length - limit),
  };
}

export async function listBoardCards(context: Context, params: CardsParams): Promise<CardsResult> {
  const config = context.config();
  const candidates = (await allBoards(await boardEntries(context))).filter(
    ({ ref }) => ref.id === params.board && (params.source === undefined || ref.source === params.source),
  );
  if (candidates.length === 0) {
    throw new InputError(fmt(_('no board "{board}" — list the boards first'), { board: params.board }));
  }
  if (candidates.length > 1) {
    throw new InputError(
      fmt(_('several sources have a board "{board}" — name the source ({sources})'), {
        board: params.board,
        sources: candidates.map(({ ref }) => ref.source).join(', '),
      }),
    );
  }
  const { entry, ref } = candidates[0];
  const includeDone = params.includeDone === true;
  const columns = await entry.source.listColumns(ref);
  const page = await entry.source.listCards(ref, {
    mine: params.mine ?? mineFor(config.boards, ref.source),
    includeClosed: includeDone,
  });
  const overrides = overridesFor(config.boards, ref);
  const type = entry.info.type;
  const rows = (page.kind === 'changed' ? page.cards : [])
    .map((card) => ({ card, lane: classifyCard(type, card, columns, overrides) }))
    .filter(({ lane }) => lane !== 'ignore' && (includeDone || lane !== 'done'))
    .sort(
      (a, b) =>
        LANE_ORDER.indexOf(a.lane) - LANE_ORDER.indexOf(b.lane) ||
        compare(a.card.due ?? '\uffff', b.card.due ?? '\uffff') ||
        compare(a.card.title, b.card.title) ||
        compare(a.card.ref.id, b.card.ref.id),
    );
  const limit = capLimit(params.limit, CARD_LIMIT);
  return {
    board: rowOf(type, ref),
    cards: rows.slice(0, limit).map(({ card, lane }) => ({
      id: card.ref.id,
      title: card.title,
      lane,
      column: card.sourceColumn,
      assignees: card.assignees.map((user) => user.displayName ?? user.id),
      due: card.due,
      url: card.url,
    })),
    omitted: Math.max(0, rows.length - limit),
  };
}
