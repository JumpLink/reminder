/**
 * The board view's state, without Gtk so it runs under Node tests: one {@link BoardSnapshot} built
 * from the sync cache, and nothing else.
 *
 * Reads come from the sync service's cache entries, the same way `model.ts` reads task lists: what
 * the view draws is what the cache holds, a board that answered "unchanged" re-renders nothing,
 * and a source that failed is a line next to the cards it still has (ADR 0017 §5). Nothing here
 * writes — the board is read-only until Phase 4 (ADR 0007 §3).
 */

import {
  errorMessage,
  overridesFor,
  type BoardsConfig,
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
  /** The board part of the configuration — the lane overrides per board. */
  config: { boards: BoardsConfig };
  /** Sources that could not even list their boards (`bindBoards`). */
  problems?: readonly BoardProblem[];
}

export interface BoardModel {
  snapshot(): BoardSnapshot;
  subscribe(listener: () => void): () => void;
  focus(): void;
  refresh(): void;
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
        boards: [...loaded.values()],
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
    refresh: () => service?.refresh(),
  };
}
