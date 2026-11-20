/**
 * The board's write path in the GUI: the one place that turns "this card was dropped in that lane"
 * into the core's `moveCard`, and the one place that decides what the person sees while the source
 * has not answered yet.
 *
 * Three rules of ADR 0013 live here. A lane is not a write target (§3), so the lane is resolved
 * against the board's own columns — and a lane that several of them map onto is *not* guessed: the
 * person is told to decide it once in the board preferences, which is where that mapping is
 * remembered. A card goes back to the lane it came from the moment the source refuses (§7),
 * because a card that stays where it was dropped is a card the person believes they moved. And
 * `canWrite` is not a permission (§2): a writable board with no grant still offers the move and
 * answers with the one line of configuration that would allow it.
 *
 * No Gtk here — the view only paints what this decides, so the optimistic lane and the rollback
 * are tested under Node.
 */

import {
  _,
  BOARD_LANES,
  boardTarget,
  ConflictError,
  errorMessage,
  fmt,
  isGranted,
  moveCard,
  resolveLaneColumn,
  type BoardLane,
  type BoardWriteContext,
  type CardRef,
} from '@reminder/core';

import {
  findBoardCard,
  laneOf,
  laneTitle,
  type BoardSnapshot,
  type BoardViewLane,
  type LoadedBoard,
  type PendingMoves,
} from './board-view-model.ts';

/** The lanes a card can be moved INTO. `unassigned` is not one: no column maps onto it on purpose. */
export const MOVE_TARGET_LANES: readonly BoardLane[] = BOARD_LANES;

export function isMoveTarget(lane: BoardViewLane): lane is BoardLane {
  return (MOVE_TARGET_LANES as readonly string[]).includes(lane);
}

export type MoveOutcome =
  | { kind: 'moved' }
  /** The card is in that lane already and no position was given: nothing was written. */
  | { kind: 'unchanged' }
  /**
   * Refused or failed; the card is back in the lane it came from. `conflict` means someone else
   * changed it, which is the one case worth offering a refresh for (ADR 0013 §7).
   */
  | { kind: 'refused'; message: string; conflict: boolean };

export interface BoardWriterDeps {
  snapshot(): BoardSnapshot;
  /** Grants and sources, asked per write: a grant added in the preferences counts without a rebuild. */
  write(): BoardWriteContext;
  /** Read the card's board again, after a write the source accepted. */
  refresh(card: CardRef): void;
  /** The optimistic lanes changed — redraw. */
  changed(): void;
}

export interface BoardWriter {
  /** The cards whose move is in flight, as `displayLane` of the view model reads them. */
  pending(): PendingMoves;
  /** Why no card of this board can be moved from here, as one sentence; null when it can. */
  blocked(board: LoadedBoard): string | null;
  /**
   * Moves a card into a lane. `position` is the drop index inside the lane as the widget counts it
   * — across every board drawn there — and is left out by the "Move to …" list, which only names a
   * lane.
   */
  move(key: string, lane: BoardViewLane, position?: number): Promise<MoveOutcome>;
  /**
   * Forgets the optimistic lane of every card the snapshot now reports there itself. Draws
   * nothing: the caller is the one that just got a new snapshot and renders anyway.
   */
  reconcile(): void;
}

/** The `<source>\n<board>` part of a `cardKey` — the cards that can share a source column. */
function boardOf(key: string): string {
  return key.slice(0, Math.max(0, key.lastIndexOf('\n')));
}

/**
 * The widget counts a drop position across every board drawn in the lane; a source column holds
 * only its own board's cards. This is the one translated into the other: how many cards of the
 * same board sit above the drop.
 */
export function columnPosition(laneKeys: readonly string[], key: string, index: number): number {
  const board = boardOf(key);
  let above = 0;
  for (let i = 0; i < index && i < laneKeys.length; i++) {
    if (laneKeys[i] !== key && boardOf(laneKeys[i]) === board) above += 1;
  }
  return above;
}

export function createBoardWriter(deps: BoardWriterDeps): BoardWriter {
  const pending = new Map<string, BoardViewLane>();

  const blocked = (board: LoadedBoard): string | null => {
    if (!board.writable) return fmt(_('{board} cannot be changed from here.'), { board: board.board.title });
    if (!isGranted(deps.write().grants, 'board.move', boardTarget(board.source, board.board.id))) {
      // Names the permission in the words the grant list uses, not a page that cannot add it yet.
      return fmt(_('Moving cards on {board} is not allowed yet — allow "Move board cards" for it first.'), {
        board: board.board.title,
      });
    }
    return null;
  };

  const refuse = (message: string, conflict = false): MoveOutcome => ({
    kind: 'refused',
    message,
    conflict,
  });

  return {
    pending: () => pending,
    blocked,
    reconcile() {
      const snapshot = deps.snapshot();
      // Deleting the current entry while iterating a Map is defined; the rest still comes.
      for (const [key, lane] of pending) {
        const found = findBoardCard(snapshot, key);
        // The card is gone from the board, or it arrived in the lane it was dropped in.
        if (found === null || laneOf(found.card, found.board) === lane) pending.delete(key);
      }
    },
    async move(key, lane, position) {
      const found = findBoardCard(deps.snapshot(), key);
      if (found === null) return refuse(_('That card is no longer on the board.'));
      const { card, board } = found;
      const from = laneOf(card, board);
      if (!isMoveTarget(lane))
        return refuse(fmt(_('{lane} is not a column to move a card into.'), { lane: laneTitle(lane) }));
      // The same lane without a position is the list offering what the card already is.
      if (from === lane && position === undefined) return { kind: 'unchanged' };

      const reason = blocked(board);
      // Before any source call, so a refusal costs no request and names what is missing.
      if (reason !== null) return refuse(reason);

      const resolved = resolveLaneColumn(board.type, board.columns, lane, board.overrides);
      if (resolved.kind === 'none') {
        return refuse(
          fmt(_('{board} has no column for {lane}.'), {
            board: board.board.title,
            lane: laneTitle(lane),
          }),
        );
      }
      if (resolved.kind === 'ambiguous') {
        // Picking one of several "done" stacks is the person's decision, and it is a lasting one.
        return refuse(
          fmt(_('{lane} is several columns of {board} — choose one under Board in the preferences.'), {
            board: board.board.title,
            lane: laneTitle(lane),
          }),
        );
      }

      pending.set(key, lane);
      deps.changed();
      try {
        await moveCard(deps.write(), {
          ref: card.ref,
          version: card.version,
          toColumn: resolved.column.name,
          ...(position === undefined ? {} : { position }),
        });
      } catch (err) {
        // Back to the lane it came from, not to whatever the next read says (ADR 0013 §7).
        pending.delete(key);
        deps.changed();
        if (err instanceof ConflictError)
          return refuse(
            fmt(_('Someone else changed "{title}" — refresh to see where it is.'), { title: card.title }),
            true,
          );
        return refuse(fmt(_('Could not move the card: {message}'), { message: errorMessage(err) }));
      }
      // The optimistic lane stays until this read lands, so the card does not jump back meanwhile.
      deps.refresh(card.ref);
      return { kind: 'moved' };
    },
  };
}
