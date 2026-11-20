/**
 * What "implements `BoardSource`" means, as runnable checks (docs/adr/0007 §7).
 *
 * Every adapter package runs these against its own fake server, under GJS and Node both, so a
 * fourth source is a package plus one line in a test file. The checks are plain async functions
 * that throw: the core depends on no test framework, and any runner can wrap them.
 *
 * What the fixture owes: at least one board, and at least one card on the first board. A source
 * whose fixture has only cards of one shape (all assigned, all open) still passes — the checks are
 * invariants, not a data review — so a fake should cover assigned and not, open and closed.
 */

import { ConflictError, InputError } from '../errors.ts';
import { CARD_TIME, type BoardRef, type BoardSource, type Card, type CardPage, type CardWrite } from './types.ts';

export interface ContractCheck {
  name: string;
  run(): Promise<void>;
}

/** A fresh source per check, so one check cannot leave state for the next. */
export type MakeBoardSource = () => BoardSource | Promise<BoardSource>;

const TIME = CARD_TIME;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`BoardSource contract: ${message}`);
}

function changed(page: CardPage, where: string): Card[] {
  assert(page.kind === 'changed', `${where} answered "unchanged" where a read was expected`);
  return page.kind === 'changed' ? page.cards : [];
}

function ids(cards: Card[]): string[] {
  return cards.map((card) => card.ref.id).sort();
}

async function firstBoard(source: BoardSource): Promise<BoardRef> {
  const boards = await source.listBoards();
  assert(boards.length > 0, 'listBoards returned nothing — the fixture needs at least one board');
  return boards[0];
}

async function rejects(promise: Promise<unknown>, where: string): Promise<void> {
  let threw = false;
  try {
    await promise;
  } catch {
    threw = true;
  }
  assert(threw, `${where} resolved for a board the source does not have`);
}

export function boardSourceContract(makeSource: MakeBoardSource): ContractCheck[] {
  return [
    {
      name: 'describes itself the same way twice, and writes only when it says so',
      async run() {
        const source = await makeSource();
        const info = source.describe();
        const again = source.describe();
        assert(info.id !== '', 'SourceInfo.id is empty');
        assert(again.id === info.id && again.type === info.type, 'describe() is not stable');
        assert(
          info.canWrite === (source.writeCard !== undefined),
          'canWrite and writeCard disagree — there is no half-written source (ADR 0013 §4)',
        );
        assert(
          again.canWrite === info.canWrite &&
            again.hasWatchers === info.hasWatchers &&
            again.changeToken === info.changeToken,
          'describe() reports different capabilities on a second call',
        );
      },
    },
    {
      name: 'names the person the credentials belong to',
      async run() {
        const source = await makeSource();
        const me = await source.whoAmI();
        assert(me.id !== '', 'whoAmI().id is empty');
        assert(me.isMe === true, 'whoAmI() returned a user that is not me');
      },
    },
    {
      name: 'lists boards with stable, unique refs that name this source',
      async run() {
        const source = await makeSource();
        const info = source.describe();
        const boards = await source.listBoards();
        assert(boards.length > 0, 'listBoards returned nothing');
        const seen = new Set<string>();
        for (const board of boards) {
          assert(board.id !== '', 'a board has an empty id');
          assert(board.title !== '', `board ${board.id} has an empty title`);
          assert(board.source === info.id, `board ${board.id} names source ${board.source}`);
          assert(!seen.has(board.id), `board id ${board.id} appears twice`);
          seen.add(board.id);
          assert(board.url === null || board.url !== '', `board ${board.id} has an empty url`);
        }
        const second = await source.listBoards();
        assert(
          second.map((b) => b.id).join('\u0000') === boards.map((b) => b.id).join('\u0000'),
          'listBoards is not stable across two calls',
        );
      },
    },
    {
      name: 'lists columns with unique names and no invented facts',
      async run() {
        const source = await makeSource();
        const board = await firstBoard(source);
        const columns = await source.listColumns(board);
        assert(columns.length > 0, `listColumns(${board.id}) returned nothing`);
        const seen = new Set<string>();
        for (const column of columns) {
          assert(column.name !== '', 'a column has an empty name');
          assert(!seen.has(column.name), `column ${column.name} appears twice`);
          seen.add(column.name);
          assert(
            column.position === null || Number.isInteger(column.position),
            `column ${column.name} has a fractional position`,
          );
        }
      },
    },
    {
      name: 'lists cards that match the port, every column known',
      async run() {
        const source = await makeSource();
        const info = source.describe();
        const board = await firstBoard(source);
        const columns = new Set((await source.listColumns(board)).map((c) => c.name));
        const page = await source.listCards(board, { mine: 'all', includeClosed: true });
        const cards = changed(page, 'listCards');
        assert(cards.length > 0, 'the fixture needs at least one card on the first board');
        assert(page.kind === 'changed' && page.omitted >= 0, 'omitted is negative');
        const seen = new Set<string>();
        for (const card of cards) {
          assert(card.ref.id !== '', 'a card has an empty id');
          assert(card.ref.source === info.id, `card ${card.ref.id} names source ${card.ref.source}`);
          assert(card.ref.board === board.id, `card ${card.ref.id} names board ${card.ref.board}`);
          assert(!seen.has(card.ref.id), `card id ${card.ref.id} appears twice`);
          seen.add(card.ref.id);
          assert(card.title !== '', `card ${card.ref.id} has an empty title`);
          assert(card.sourceColumn !== '', `card ${card.ref.id} has an empty sourceColumn`);
          assert(
            columns.has(card.sourceColumn),
            `card ${card.ref.id} is in column "${card.sourceColumn}", which listColumns does not report`,
          );
          assert(card.due === null || TIME.test(card.due), `card ${card.ref.id} has an unparseable due ${card.due}`);
          assert(
            card.updated === null || TIME.test(card.updated),
            `card ${card.ref.id} has an unparseable updated ${card.updated}`,
          );
          assert(card.url === null || card.url !== '', `card ${card.ref.id} has an empty url`);
          for (const user of card.assignees) assert(user.id !== '', `card ${card.ref.id} has an assignee without id`);
          for (const label of card.labels) assert(label.name !== '', `card ${card.ref.id} has a label without a name`);
          if (!info.hasWatchers)
            assert(
              card.watchedByMe === null,
              `card ${card.ref.id} reports watchedByMe although describe() says hasWatchers: false`,
            );
        }
      },
    },
    {
      name: 'defaults to the cards assigned to me, open ones only',
      async run() {
        const source = await makeSource();
        const board = await firstBoard(source);
        const byDefault = changed(await source.listCards(board), 'listCards()');
        const assigned = changed(await source.listCards(board, { mine: 'assigned' }), 'listCards(assigned)');
        assert(
          ids(byDefault).join('\u0000') === ids(assigned).join('\u0000'),
          'the default query is not "assigned"',
        );
        for (const card of byDefault) {
          assert(
            card.assignees.some((user) => user.isMe),
            `card ${card.ref.id} is in the "assigned" answer without an assignee that is me`,
          );
          assert(card.closed !== true, `card ${card.ref.id} is closed but the default query returned it`);
        }
      },
    },
    {
      name: 'widens from assigned to watching to all',
      async run() {
        const source = await makeSource();
        const info = source.describe();
        const board = await firstBoard(source);
        const assigned = changed(await source.listCards(board, { mine: 'assigned' }), 'listCards(assigned)');
        const watching = changed(await source.listCards(board, { mine: 'watching' }), 'listCards(watching)');
        const all = changed(await source.listCards(board, { mine: 'all' }), 'listCards(all)');
        const watchingIds = new Set(ids(watching));
        const allIds = new Set(ids(all));
        for (const id of ids(assigned)) {
          assert(watchingIds.has(id), `card ${id} is assigned to me but missing from "watching"`);
          assert(allIds.has(id), `card ${id} is assigned to me but missing from "all"`);
        }
        for (const id of watchingIds) assert(allIds.has(id), `card ${id} is watched but missing from "all"`);
        if (!info.hasWatchers)
          assert(
            watchingIds.size === assigned.length,
            'the source has no watchers, so "watching" must answer exactly what "assigned" does',
          );
      },
    },
    {
      name: 'keeps closed cards out unless asked, and honours the cap',
      async run() {
        const source = await makeSource();
        const board = await firstBoard(source);
        const open = changed(await source.listCards(board, { mine: 'all' }), 'listCards(all)');
        for (const card of open) assert(card.closed !== true, `card ${card.ref.id} is closed but was returned`);
        const withClosed = changed(await source.listCards(board, { mine: 'all', includeClosed: true }), 'listCards');
        assert(withClosed.length >= open.length, 'includeClosed returned fewer cards than the open query');

        const capped = await source.listCards(board, { mine: 'all', includeClosed: true, limit: 1 });
        const cards = changed(capped, 'listCards(limit)');
        assert(cards.length <= 1, 'limit 1 returned more than one card');
        assert(
          capped.kind === 'changed' && cards.length + capped.omitted === withClosed.length,
          'the capped answer does not report how many it left out',
        );
      },
    },
    {
      name: 'answers "unchanged" for an unchanged read, or never claims to',
      async run() {
        const source = await makeSource();
        const info = source.describe();
        const board = await firstBoard(source);
        const first = await source.listCards(board);
        assert(first.kind === 'changed', 'the first read answered "unchanged"');
        const token = first.kind === 'changed' ? first.token : null;
        if (!info.changeToken) {
          assert(token === null, 'describe() says changeToken: false but a token came back');
          const again = await source.listCards(board, undefined, 'anything');
          assert(again.kind === 'changed', 'a source without change detection answered "unchanged"');
          return;
        }
        assert(token !== null, 'describe() says changeToken: true but no token came back');
        const again = await source.listCards(board, undefined, token);
        assert(again.kind === 'unchanged', 'a repeated read with the previous token did not answer "unchanged"');
        const stale = await source.listCards(board, undefined, `${token}-stale`);
        assert(stale.kind === 'changed', 'an unknown token was treated as current');
      },
    },
    {
      name: 'refuses a board it does not have',
      async run() {
        const source = await makeSource();
        const info = source.describe();
        const absent: BoardRef = { source: info.id, id: 'no-such-board', title: 'absent', url: null };
        await rejects(source.listColumns(absent), 'listColumns');
        await rejects(source.listCards(absent), 'listCards');
      },
    },
  ];
}

async function raises(promise: Promise<unknown>, type: new (...args: never[]) => Error, where: string): Promise<void> {
  let error: unknown = null;
  try {
    await promise;
  } catch (err) {
    error = err;
  }
  assert(error !== null, `${where} resolved`);
  assert(error instanceof type, `${where} raised ${String(error)} instead of ${type.name}`);
}

async function everyCard(source: BoardSource, board: BoardRef): Promise<Card[]> {
  return changed(await source.listCards(board, { mine: 'all', includeClosed: true }), 'listCards');
}

/**
 * The write half (docs/adr/0013 §4). Run it for a source that claims `canWrite`; it needs a first
 * board with a card and at least two columns. A write with a stale version must raise
 * `ConflictError` and leave the card as it was, a column the source lacks is an `InputError`, and
 * a success returns the card as the source has it afterwards.
 */
export function boardSourceWriteContract(makeSource: MakeBoardSource): ContractCheck[] {
  const prepare = async () => {
    const source = await makeSource();
    assert(source.describe().canWrite && source.writeCard !== undefined, 'the source does not claim to write');
    const board = await firstBoard(source);
    const columns = await source.listColumns(board);
    assert(columns.length >= 2, 'the write checks need at least two columns');
    const cards = await everyCard(source, board);
    assert(cards.length > 0, 'the fixture needs at least one card on the first board');
    const card = cards[0];
    const target = columns.find((c) => c.name !== card.sourceColumn) ?? columns[0];
    const write = (request: CardWrite) => (source.writeCard as (w: CardWrite) => Promise<Card>)(request);
    return { source, board, columns, card, target, write };
  };
  const find = (cards: Card[], id: string) => cards.find((c) => c.ref.id === id);

  return [
    {
      name: 'moves a card and answers the card as the source has it',
      async run() {
        const { source, board, card, target, write } = await prepare();
        const result = await write({ kind: 'move', ref: card.ref, version: card.version, toColumn: target.name });
        assert(result.sourceColumn === target.name, `the move answered column "${result.sourceColumn}"`);
        assert(result.ref.id === card.ref.id, 'the move answered another card');
        const stored = find(await everyCard(source, board), card.ref.id);
        assert(stored !== undefined, 'the moved card is gone from the board');
        assert(stored?.sourceColumn === target.name, 'the read after the move shows another column');
        assert(stored?.version === result.version, 'the answer is not the card the next read shows');
      },
    },
    {
      name: 'updates title and due date and answers the stored card',
      async run() {
        const { source, board, card, write } = await prepare();
        const result = await write({
          kind: 'update',
          ref: card.ref,
          version: card.version,
          changes: { title: 'Renamed by the contract', due: '2027-02-03' },
        });
        assert(result.title === 'Renamed by the contract' && result.due === '2027-02-03', 'the update was not applied');
        const stored = find(await everyCard(source, board), card.ref.id);
        assert(stored?.title === result.title && stored?.due === result.due, 'the read after the update differs');
        assert(stored?.sourceColumn === card.sourceColumn, 'an update moved the card');
      },
    },
    {
      name: 'refuses a stale version with ConflictError and writes nothing',
      async run() {
        const { source, board, card, target, write } = await prepare();
        await write({ kind: 'update', ref: card.ref, version: card.version, changes: { title: 'Second person' } });
        await raises(
          write({ kind: 'move', ref: card.ref, version: card.version, toColumn: target.name }),
          ConflictError,
          'a move with a stale version',
        );
        await raises(
          write({ kind: 'update', ref: card.ref, version: card.version, changes: { title: 'Lost update' } }),
          ConflictError,
          'an update with a stale version',
        );
        const stored = find(await everyCard(source, board), card.ref.id);
        assert(stored?.title === 'Second person', 'a refused write changed the title');
        assert(stored?.sourceColumn === card.sourceColumn, 'a refused write moved the card');
      },
    },
    {
      name: 'refuses a column it does not have with InputError and writes nothing',
      async run() {
        const { source, board, card, write } = await prepare();
        await raises(
          write({ kind: 'move', ref: card.ref, version: card.version, toColumn: 'No such column' }),
          InputError,
          'a move to an absent column',
        );
        await raises(
          write({ kind: 'create', board: board.id, column: 'No such column', title: 'Never added' }),
          InputError,
          'a create in an absent column',
        );
        const cards = await everyCard(source, board);
        assert(find(cards, card.ref.id)?.sourceColumn === card.sourceColumn, 'a refused move changed the card');
        assert(!cards.some((c) => c.title === 'Never added'), 'a refused create added a card');
      },
    },
    {
      name: 'creates a card in a column and answers the stored card',
      async run() {
        const { source, board, target, write } = await prepare();
        const result = await write({ kind: 'create', board: board.id, column: target.name, title: 'Added by the contract' });
        assert(result.ref.board === board.id && result.ref.source === source.describe().id, 'the new card names another board');
        assert(result.title === 'Added by the contract' && result.sourceColumn === target.name, 'the new card differs');
        const stored = find(await everyCard(source, board), result.ref.id);
        assert(stored !== undefined, 'the new card is not on the board');
        assert(stored?.version === result.version, 'the answer is not the card the next read shows');
      },
    },
    {
      name: 'refuses to write to a board it does not have',
      async run() {
        const { source, columns, write } = await prepare();
        await rejects(
          write({ kind: 'create', board: 'no-such-board', column: columns[0].name, title: 'Nowhere' }),
          'create',
        );
        const absent = { source: source.describe().id, board: 'no-such-board', id: 'x' };
        await rejects(write({ kind: 'move', ref: absent, version: null, toColumn: columns[0].name }), 'move');
      },
    },
  ];
}
