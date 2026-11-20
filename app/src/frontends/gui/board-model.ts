/**
 * The board view's state, without Gtk so it runs under Node tests: one {@link BoardSnapshot} built
 * from the sync cache, and nothing else.
 *
 * Reads come from the sync service's cache entries, the same way `model.ts` reads task lists: what
 * the view draws is what the cache holds, a board that answered "unchanged" re-renders nothing,
 * and a source that failed is a line next to the cards it still has (ADR 0017 §5).
 *
 * Writing is not done here either: what this adds is the {@link BoardWriteContext} the core's
 * `moveCard` takes — the configured grants and the lookup from a `SourceInfo.id` back to the
 * source the bindings already hold — plus a `refresh` that can name one board, so a card that was
 * just written is read again without asking every source.
 */

import {
  errorMessage,
  overridesFor,
  type BoardsConfig,
  type BoardWriteContext,
  type CardRef,
  type Grant,
  type SourceStatus,
  type SyncService,
} from '@reminder/core';

import { decodeBoardBody } from '../../core/board-cache.ts';
import type { BoardBinding } from './board-sync.ts';
import {
  emptyBoardSnapshot,
  type BoardProblem,
  type BoardSnapshot,
  type LoadedBoard,
} from './board-view-model.ts';
import { stateLabel } from './view-model.ts';

export interface BoardModelDeps {
  /** Every board of every source, with the cache key its cards live under. */
  boards: readonly BoardBinding[];
  /** Null when no source could be set up; the model then only has `problems`. */
  service: SyncService | null;
  /** The lane overrides per board, and the grants a write has to pass (ADR 0013 §3). */
  config: { boards: BoardsConfig; grants: readonly Grant[] };
  /** Sources that could not even list their boards (`bindBoards`). */
  problems?: readonly BoardProblem[];
  /** Hidden-source keys (`board:<id>`) of the GUI settings; those sources are not drawn. */
  hidden?: ReadonlySet<string>;
}

export interface BoardModel {
  snapshot(): BoardSnapshot;
  subscribe(listener: () => void): () => void;
  focus(): void;
  /** Fetch now: the board a card belongs to, or every board when no card is named. */
  refresh(card?: CardRef): void;
  /** What `moveCard` and friends need — grants plus the source behind an id. */
  write(): BoardWriteContext;
}

const idOf = (binding: BoardBinding): string => `${binding.key.account}\n${binding.key.source}`;

export function createBoardModel(deps: BoardModelDeps): BoardModel {
  const { boards, service } = deps;
  const byKey = new Map(boards.map((binding) => [idOf(binding), binding]));
  const loaded = new Map<string, LoadedBoard>();
  const failed = new Map<string, BoardProblem>();
  const answered = new Set<string>();
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const labelOf = (binding: BoardBinding): string => binding.board.title || binding.entry.info.id;

  const ingest = (binding: BoardBinding, body: string): void => {
    const decoded = decodeBoardBody(body);
    // A body that does not decode is a damaged cache file, not an error: keep what was there.
    if (decoded === null) return;
    loaded.set(idOf(binding), {
      source: binding.entry.info.id,
      type: binding.entry.info.type,
      board: binding.board,
      columns: decoded.columns,
      cards: decoded.cards,
      overrides: overridesFor(deps.config.boards, binding.board),
      writable: binding.entry.info.canWrite,
    });
  };

  const note = (binding: BoardBinding, status: SourceStatus): void => {
    const label = stateLabel(status.state);
    if (label === null) {
      failed.delete(idOf(binding));
      return;
    }
    failed.set(idOf(binding), { source: binding.entry.info.id, label: labelOf(binding), message: label });
  };

  service?.subscribe((key, status, entry) => {
    const binding = byKey.get(`${key.account}\n${key.source}`);
    if (!binding) return;
    if (entry) {
      try {
        ingest(binding, entry.body);
      } catch (err) {
        failed.set(idOf(binding), {
          source: binding.entry.info.id,
          label: labelOf(binding),
          message: errorMessage(err),
        });
      }
    }
    // `pending` is the state before the first attempt finished — it is not an answer.
    if (status.state.kind !== 'pending') answered.add(idOf(binding));
    note(binding, status);
    notify();
  });

  return {
    snapshot(): BoardSnapshot {
      if (boards.length === 0 && (deps.problems?.length ?? 0) === 0)
        return { ...emptyBoardSnapshot(), loading: false };
      return {
        boards: [...loaded.values()].filter((b) => !deps.hidden?.has(`board:${b.source}`)),
        problems: [...(deps.problems ?? []), ...failed.values()],
        loading: boards.some((binding) => !answered.has(idOf(binding))),
        configured: true,
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    focus: () => service?.focus(),
    refresh(card) {
      if (card === undefined) {
        service?.refresh();
        return;
      }
      const binding = boards.find(
        (entry) => entry.entry.info.id === card.source && entry.board.id === card.board,
      );
      // A card whose board is no longer bound: nothing to re-read, and no reason to fetch all.
      if (binding) service?.refresh({ ...binding.key });
    },
    write() {
      return {
        grants: deps.config.grants,
        source: (id) => boards.find((binding) => binding.entry.info.id === id)?.entry.source,
      };
    },
  };
}
