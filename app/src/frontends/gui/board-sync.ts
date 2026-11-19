/**
 * Boards on the window's sync schedule (docs/adr/0017): every board of every source becomes one
 * sync source, so a board is fetched on the same interval, under the same per-host cap and with
 * the same backoff as a task list — and a source that answers "unchanged" costs one request and
 * no re-render.
 *
 * Every read asks the same question ({@link BOARD_QUERY}): everyone's cards, closed ones included.
 * A change token belongs to a board AND the query it came from, so a filter the person flips in
 * the header must not change the question — the chips filter what arrived (`board-view-model.ts`),
 * which is also why they switch without a fetch. The CLI and the MCP server pass a narrower
 * `CardQuery` down instead, which is what ADR 0008 §5 is about.
 */

import {
  errorMessage,
  type BoardRef,
  type CacheKey,
  type CardQuery,
  type SyncFetch,
  type SyncSource,
} from '@reminder/core';

import { boardCacheKey, encodeBoardBody } from '../../core/board-cache.ts';
import type { BoardSourceEntry } from '../../core/board-sources.ts';
import type { BoardProblem } from './board-view-model.ts';

/** The one question every board read asks. See the file comment. */
export const BOARD_QUERY: CardQuery = { mine: 'all', includeClosed: true };

/** One board of one source, with the cache key its cards live under. */
export interface BoardBinding {
  entry: BoardSourceEntry;
  board: BoardRef;
  key: CacheKey;
}

export interface BoundBoards {
  bindings: BoardBinding[];
  /** One line per source whose boards could not even be listed. */
  problems: BoardProblem[];
}

/**
 * Asks every source which boards it has. A source that cannot answer costs only itself: its line
 * lands in `problems` and the other boards still load (ADR 0017 §5).
 */
export async function bindBoards(entries: readonly BoardSourceEntry[]): Promise<BoundBoards> {
  const bindings: BoardBinding[] = [];
  const problems: BoardProblem[] = [];
  for (const entry of entries) {
    try {
      for (const board of await entry.source.listBoards())
        bindings.push({ entry, board, key: boardCacheKey(entry.info.id, board.id) });
    } catch (err) {
      problems.push({ source: entry.info.id, label: entry.info.id, message: errorMessage(err) });
    }
  }
  return { bindings, problems };
}

export function boardSyncSources(bindings: readonly BoardBinding[]): SyncSource[] {
  return bindings.map((binding) => ({
    key: { ...binding.key },
    kind: binding.entry.kind,
    host: binding.entry.host,
  }));
}

/**
 * The fetch port for board keys. `listColumns` is skipped when the cards come back unchanged: the
 * cached body holds the columns of that same read, and asking again would cost a request to learn
 * nothing.
 */
export function createBoardSyncFetch(bindings: readonly BoardBinding[]): SyncFetch {
  const byKey = new Map(
    bindings.map((binding) => [`${binding.key.account}\n${binding.key.source}`, binding]),
  );
  return async (key, previousVersion) => {
    const binding = byKey.get(`${key.account}\n${key.source}`);
    if (!binding) throw new Error('no board source for this key');
    const page = await binding.entry.source.listCards(binding.board, BOARD_QUERY, previousVersion);
    if (page.kind === 'unchanged') return { kind: 'unchanged' };
    const columns = await binding.entry.source.listColumns(binding.board);
    return { kind: 'changed', body: encodeBoardBody({ columns, cards: page.cards }), version: page.token };
  };
}
