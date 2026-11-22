/**
 * `reminder board` — the boards of every enabled source (docs/adr/0007), and one card at a time
 * written by name (docs/adr/0013 §8). A write needs a grant for that board, like every frontend.
 *
 * A broken account fails the whole command (docs/adr/0005): a partial board list reads as the
 * full one.
 */

import type { CommandModule } from 'yargs';

import { _, BOARD_LIMIT, CARD_LIMIT, fmt, MINE_FILTERS, type MineFilter } from '@reminder/core';

import {
  addBoardCard,
  listBoardCards,
  listBoards,
  moveBoardCardByName,
  updateBoardCard,
  type BoardRow,
  type CardRow,
  type MoveResult,
} from '../../core/board-read.ts';
import { createContext } from '../../core/context.ts';
import { dim, omittedLine, pickArgv, printJson, runAndExit, shortTime } from './output.ts';

const sourceOption = { type: 'string', describe: _('Source id, when two sources share a board id') } as const;
const dueDescription = _('Due date: YYYY-MM-DD or an ISO date-time');

export function boardLine(b: BoardRow): string {
  return `${b.source}  ${b.id}  ${b.title}${b.url ? dim(`  ${b.url}`) : ''}`;
}

export function cardLine(c: CardRow): string {
  const who = c.assignees.length > 0 ? `  @${c.assignees.join(', @')}` : '';
  const due = c.due ? `  ${fmt(_('due {time}'), { time: shortTime(c.due) })}` : '';
  return `[${c.lane}] ${c.title}${dim(`  (${c.column})${who}${due}${c.url ? `  ${c.url}` : ''}`)}`;
}

const listCommand: CommandModule = {
  command: 'list',
  describe: _('List the boards of every enabled source'),
  builder: (yargs) =>
    yargs
      .option('limit', {
        type: 'number',
        describe: fmt(_('Max boards (default {default}, max {max})'), {
          default: BOARD_LIMIT.default,
          max: BOARD_LIMIT.max,
        }),
      })
      .option('json', { type: 'boolean', default: false }),
  handler: (argv) => {
    const raw = argv as Record<string, unknown>;
    const asJson = pickArgv<boolean>(raw, 'json') ?? false;
    runAndExit(
      () => listBoards(createContext(), { limit: pickArgv<number>(raw, 'limit') }),
      (result) => {
        if (asJson) return printJson(result);
        if (result.boards.length === 0) console.log(_('No boards.'));
        for (const b of result.boards) console.log(boardLine(b));
        const more = omittedLine(result.omitted, '--limit');
        if (more) console.log(more);
      },
    );
  },
};

const cardsCommand: CommandModule = {
  command: 'cards <board>',
  describe: _('List the cards of one board (id from `reminder board list`)'),
  builder: (yargs) =>
    yargs
      .positional('board', { type: 'string', describe: _('Board id') })
      .option('source', sourceOption)
      .option('mine', {
        type: 'string',
        choices: [...MINE_FILTERS],
        describe: _('Whose cards: assigned, watching or all (default: the configuration)'),
      })
      .option('all', { type: 'boolean', default: false, describe: _('Same as --mine all') })
      .option('include-done', {
        type: 'boolean',
        default: false,
        describe: _('Include cards in the done lane'),
      })
      .option('limit', {
        type: 'number',
        describe: fmt(_('Max cards (default {default}, max {max})'), {
          default: CARD_LIMIT.default,
          max: CARD_LIMIT.max,
        }),
      })
      .option('json', { type: 'boolean', default: false }),
  handler: (argv) => {
    const raw = argv as Record<string, unknown>;
    const asJson = pickArgv<boolean>(raw, 'json') ?? false;
    const everyone = pickArgv<boolean>(raw, 'all') ?? false;
    runAndExit(
      () =>
        listBoardCards(createContext(), {
          board: String(raw.board),
          source: pickArgv<string>(raw, 'source'),
          mine: everyone ? 'all' : pickArgv<MineFilter>(raw, 'mine'),
          includeDone: pickArgv<boolean>(raw, 'includeDone', 'include-done'),
          limit: pickArgv<number>(raw, 'limit'),
        }),
      (result) => {
        if (asJson) return printJson(result);
        console.log(`${result.board.title}${result.board.url ? dim(`  ${result.board.url}`) : ''}`);
        if (result.cards.length === 0) console.log(_('No cards.'));
        for (const c of result.cards) console.log(cardLine(c));
        const more = omittedLine(result.omitted, '--limit');
        if (more) console.log(more);
      },
    );
  },
};

function printWritten(asJson: boolean): (result: MoveResult) => void {
  return (result) => {
    if (asJson) return printJson(result);
    console.log(cardLine(result.card));
  };
}

const moveCommand: CommandModule = {
  command: 'move <board> <card> <column>',
  describe: _('Move one card to another column (needs a board.move grant)'),
  builder: (yargs) =>
    yargs
      .positional('board', { type: 'string', describe: _('Board id') })
      .positional('card', { type: 'string', describe: _('Card id from `reminder board cards --json`') })
      .positional('column', { type: 'string', describe: _('Target column as the source names it') })
      .option('source', sourceOption)
      .option('json', { type: 'boolean', default: false }),
  handler: (argv) => {
    const raw = argv as Record<string, unknown>;
    runAndExit(
      () =>
        moveBoardCardByName(createContext(), {
          board: String(raw.board),
          card: String(raw.card),
          column: String(raw.column),
          source: pickArgv<string>(raw, 'source'),
        }),
      printWritten(pickArgv<boolean>(raw, 'json') ?? false),
    );
  },
};

const addCommand: CommandModule = {
  command: 'add <board> <column> <title>',
  describe: _('Add a card to a column (needs a board.create grant)'),
  builder: (yargs) =>
    yargs
      .positional('board', { type: 'string', describe: _('Board id') })
      .positional('column', { type: 'string', describe: _('Column as the source names it') })
      .positional('title', { type: 'string', describe: _('Card title') })
      .option('due', { type: 'string', describe: dueDescription })
      .option('source', sourceOption)
      .option('json', { type: 'boolean', default: false }),
  handler: (argv) => {
    const raw = argv as Record<string, unknown>;
    runAndExit(
      () =>
        addBoardCard(createContext(), {
          board: String(raw.board),
          column: String(raw.column),
          title: String(raw.title),
          due: pickArgv<string>(raw, 'due'),
          source: pickArgv<string>(raw, 'source'),
        }),
      printWritten(pickArgv<boolean>(raw, 'json') ?? false),
    );
  },
};

const setCommand: CommandModule = {
  command: 'set <board> <card>',
  describe: _('Change the title or the due date of one card (needs a board.update grant)'),
  builder: (yargs) =>
    yargs
      .positional('board', { type: 'string', describe: _('Board id') })
      .positional('card', { type: 'string', describe: _('Card id from `reminder board cards --json`') })
      .option('title', { type: 'string', describe: _('New title') })
      .option('due', { type: 'string', describe: dueDescription })
      .option('clear-due', { type: 'boolean', default: false, describe: _('Remove the due date') })
      .conflicts('due', 'clear-due')
      .option('source', sourceOption)
      .option('json', { type: 'boolean', default: false }),
  handler: (argv) => {
    const raw = argv as Record<string, unknown>;
    const clearDue = pickArgv<boolean>(raw, 'clearDue', 'clear-due') ?? false;
    runAndExit(
      () =>
        updateBoardCard(createContext(), {
          board: String(raw.board),
          card: String(raw.card),
          title: pickArgv<string>(raw, 'title'),
          due: clearDue ? null : pickArgv<string>(raw, 'due'),
          source: pickArgv<string>(raw, 'source'),
        }),
      printWritten(pickArgv<boolean>(raw, 'json') ?? false),
    );
  },
};

export const boardCommand: CommandModule = {
  command: 'board',
  describe: _('Read boards and their cards, and write one card at a time'),
  builder: (yargs) =>
    yargs
      .command(listCommand)
      .command(cardsCommand)
      .command(moveCommand)
      .command(addCommand)
      .command(setCommand)
      .demandCommand(1, _('Give a board command — `reminder board --help` lists them.')),
  handler: () => {},
};
