/**
 * The board's write path as the view uses it: the card is in the new lane before the source has
 * answered, it is back in the old one the moment the source refuses, and a board without the
 * `board.move` grant costs no request at all (ADR 0013 §2, §7).
 *
 * The optimistic lane is checked BEFORE awaiting the call on purpose — that is exactly the window
 * the person sees, and a test that only looks at the end cannot tell it from a move that redrew
 * once the source was done.
 */

import { describe, expect, it } from '@gjsify/unit';
import {
  boardTarget,
  emptyBoardsConfig,
  overridesFor,
  type Card,
  type CardRef,
  type Grant,
} from '@reminder/core';

import { createDemoBoardSource, demoConfig, DEMO_BOARD_SOURCE_ID } from '../../../src/core/demo/index.ts';
import {
  cardKey,
  displayLane,
  laneOf,
  type BoardSnapshot,
  type LoadedBoard,
} from '../../../src/frontends/gui/board-view-model.ts';
import { columnPosition, createBoardWriter } from '../../../src/frontends/gui/board-write.ts';
import { createFakeBoardSource, type FakeBoardSource } from '../board/fake-board-source.ts';

const SOURCE = 'fake';
const BOARD = 'b-workshop';
const MOVE: Grant[] = [{ capability: 'board.move', target: boardTarget(SOURCE, BOARD) }];

/** The fake's own board and cards as the view model holds them — one wide read, like `BOARD_QUERY`. */
async function loadBoard(source: FakeBoardSource, writable = true): Promise<LoadedBoard> {
  const board = (await source.listBoards()).find((b) => b.id === BOARD);
  if (!board) throw new Error(`the fake lost ${BOARD}`);
  const page = await source.listCards(board, { mine: 'all', includeClosed: true });
  return {
    source: SOURCE,
    type: 'deck',
    board,
    columns: await source.listColumns(board),
    cards: page.kind === 'changed' ? page.cards : [],
    overrides: overridesFor(emptyBoardsConfig(), board),
    writable,
  };
}

async function harness(options: { grants?: Grant[]; writable?: boolean } = {}) {
  const source = createFakeBoardSource({ id: SOURCE, writable: true });
  let board = await loadBoard(source, options.writable ?? true);
  const refreshed: CardRef[] = [];
  let draws = 0;
  const writer = createBoardWriter({
    snapshot: (): BoardSnapshot => ({
      boards: [board],
      problems: [],
      loading: false,
      configured: true,
    }),
    write: () => ({
      grants: options.grants ?? MOVE,
      source: (id) => (id === SOURCE ? source : undefined),
    }),
    refresh: (card) => refreshed.push(card),
    changed: () => {
      draws += 1;
    },
  });
  const find = (id: string): Card => {
    const card = board.cards.find((c) => c.ref.id === id);
    if (!card) throw new Error(`no card ${id}`);
    return card;
  };
  return {
    source,
    writer,
    refreshed,
    get board() {
      return board;
    },
    get draws() {
      return draws;
    },
    key: (id: string): string => cardKey(find(id).ref),
    /** The lane the card is drawn in right now — the dropped one while a write is in flight. */
    lane: (id: string): string | null => displayLane(find(id), board, writer.pending()),
    /** The read the writer asked for landing: the source now reports the card in `column`. */
    arrived(id: string, column: string, closed: boolean): void {
      board = {
        ...board,
        cards: board.cards.map((card) =>
          card.ref.id === id ? { ...card, sourceColumn: column, closed } : card,
        ),
      };
    },
  };
}

export default async () => {
  await describe('board writer', async () => {
    await it('shows the card in the new lane before the source answered', async () => {
      const h = await harness();
      const key = h.key('c1');
      expect(h.lane('c1')).toEqual('todo');

      const pending = h.writer.move(key, 'in-progress');
      // The whole point of the optimistic move: this holds while the request is still in flight.
      expect(h.lane('c1')).toEqual('in-progress');
      expect(h.draws).toEqual(1);

      const outcome = await pending;
      expect(outcome.kind).toEqual('moved');
      expect(h.source.calls.includes('writeCard:move')).toEqual(true);
      // Only the card's own board is read again, not every source.
      expect(h.refreshed.length).toEqual(1);
      expect(h.refreshed[0]?.id).toEqual('c1');
      // Still optimistic: the lane holds until that read lands, so the card does not jump back.
      expect(h.writer.pending().get(key)).toEqual('in-progress');
    });

    await it('puts the card back when someone else changed it', async () => {
      const h = await harness();
      const key = h.key('c1');
      // A second person moves the same card, so the version the view holds is stale.
      h.source.move('c1', 'Done');

      const pending = h.writer.move(key, 'in-progress');
      expect(h.lane('c1')).toEqual('in-progress');

      const outcome = await pending;
      expect(outcome.kind).toEqual('refused');
      expect(outcome.kind === 'refused' && outcome.conflict).toEqual(true);
      expect(outcome.kind === 'refused' && outcome.message.includes('Sharpen the plane iron')).toEqual(true);
      // Back in the lane it came from — not in whatever the next read will say (ADR 0013 §7).
      expect(h.lane('c1')).toEqual('todo');
      expect(h.writer.pending().size).toEqual(0);
      // A refused write changed nothing, so there is nothing to read again.
      expect(h.refreshed.length).toEqual(0);
    });

    await it('asks the source nothing without the grant', async () => {
      const h = await harness({ grants: [] });
      const outcome = await h.writer.move(h.key('c1'), 'in-progress');

      expect(outcome.kind).toEqual('refused');
      expect(outcome.kind === 'refused' && outcome.conflict).toEqual(false);
      expect(h.source.calls.includes('writeCard:move')).toEqual(false);
      // The card never left its lane, so there was nothing to draw either.
      expect(h.lane('c1')).toEqual('todo');
      expect(h.draws).toEqual(0);
      expect(outcome.kind === 'refused' && outcome.message.includes('Workshop')).toEqual(true);
    });

    await it('tells a missing grant from an adapter that cannot write', async () => {
      const granted = await harness();
      expect(granted.writer.blocked(granted.board)).toEqual(null);

      const ungranted = await harness({ grants: [] });
      const missing = ungranted.writer.blocked(ungranted.board);
      expect(missing !== null && missing.includes('Move board cards')).toEqual(true);

      // `canWrite: false` is the adapter, never a permission — a different sentence (ADR 0013 §2).
      const readOnly = await harness({ writable: false });
      const cannot = readOnly.writer.blocked(readOnly.board);
      expect(cannot !== null && cannot.includes('Move board cards')).toEqual(false);
      expect(cannot !== null && cannot.includes('Workshop')).toEqual(true);

      const outcome = await readOnly.writer.move(readOnly.key('c1'), 'done');
      expect(outcome.kind).toEqual('refused');
      expect(outcome.kind === 'refused' && outcome.message).toEqual(cannot);
      expect(readOnly.source.calls.includes('writeCard:move')).toEqual(false);
    });

    await it('writes nothing when the lane is the one the card is in', async () => {
      const h = await harness();
      const outcome = await h.writer.move(h.key('c1'), 'todo');

      expect(outcome.kind).toEqual('unchanged');
      expect(h.source.calls.includes('writeCard:move')).toEqual(false);
    });

    await it('forgets the optimistic lane once the card arrives there', async () => {
      const h = await harness();
      const key = h.key('c2');
      await h.writer.move(key, 'done');
      expect(h.writer.pending().get(key)).toEqual('done');

      // Nothing arrived yet: the snapshot still has the card where it was, so the lane must hold.
      h.writer.reconcile();
      expect(h.writer.pending().get(key)).toEqual('done');

      h.arrived('c2', 'Done', true);
      h.writer.reconcile();
      expect(h.writer.pending().size).toEqual(0);
      expect(h.lane('c2')).toEqual('done');
    });

    await it('counts a drop position within the card’s own board', () => {
      // The lane holds two boards interleaved; a source column holds only its own.
      const lane = ['a\nb1\nc1', 'x\nb9\nc9', 'a\nb1\nc2', 'a\nb1\nc3'];
      expect(columnPosition(lane, 'a\nb1\nc3', 0)).toEqual(0);
      expect(columnPosition(lane, 'a\nb1\nc3', 2)).toEqual(1);
      // The dragged card itself never counts, wherever it sits above the drop.
      expect(columnPosition(lane, 'a\nb1\nc1', 3)).toEqual(1);
      expect(columnPosition(lane, 'a\nb1\nc1', 9)).toEqual(2);
    });

    await it('moves a demo card with the grants the demo config ships', async () => {
      // The board the screenshots show: its source writes to memory and its grant is in the config.
      const source = createDemoBoardSource(new Date(2026, 10, 18, 9, 0));
      const demoBoard = (await source.listBoards())[0];
      const page = await source.listCards(demoBoard, { mine: 'all', includeClosed: true });
      let board: LoadedBoard = {
        source: DEMO_BOARD_SOURCE_ID,
        type: 'deck',
        board: demoBoard,
        columns: await source.listColumns(demoBoard),
        cards: page.kind === 'changed' ? page.cards : [],
        overrides: overridesFor(emptyBoardsConfig(), demoBoard),
        writable: source.describe().canWrite,
      };
      const writer = createBoardWriter({
        snapshot: () => ({ boards: [board], problems: [], loading: false, configured: true }),
        write: () => ({
          grants: demoConfig().grants,
          source: (id) => (id === DEMO_BOARD_SOURCE_ID ? source : undefined),
        }),
        refresh: () => {},
        changed: () => {},
      });
      expect(writer.blocked(board)).toEqual(null);

      const card = board.cards[0];
      const outcome = await writer.move(cardKey(card.ref), 'done');
      expect(outcome.kind).toEqual('moved');

      // The source kept it: a second read puts the card in a closed column.
      const after = await source.listCards(demoBoard, { mine: 'all', includeClosed: true });
      board = { ...board, cards: after.kind === 'changed' ? after.cards : [] };
      const moved = board.cards.find((c) => c.ref.id === card.ref.id);
      expect(moved !== undefined && laneOf(moved, board)).toEqual('done');
    });

    await it('maps the fake columns onto four distinct lanes', async () => {
      const h = await harness();
      const lanes = h.board.cards.map((card) => laneOf(card, h.board));
      for (const lane of ['backlog', 'todo', 'in-progress', 'done'])
        expect(lanes.includes(lane as never)).toEqual(true);
    });
  });
};
