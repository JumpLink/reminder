/**
 * The board read tools (docs/adr/0007, 0008). Read-only: no grant, no write path. Caps come from
 * limits.ts; `omitted` says how many matches the cap cut off. Rows carry no description.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { mcpErrorFrom, mcpSuccess, requiresCapability } from '@gjsify/mcp';
import { BOARD_LANES, BOARD_LIMIT, boardTarget, CARD_LIMIT, MINE_FILTERS } from '@reminder/core';
import { z } from 'zod';

import { listBoardCards, listBoards, moveBoardCard } from '../../../core/board-read.ts';
import type { Context } from '../../../core/context.ts';

export function registerBoardTools(server: McpServer, context: Context): void {
  server.registerTool(
    'boards_list',
    {
      title: 'List boards',
      description:
        'The boards of every enabled source (source, type, id, title, url), sorted by source then id. Sources the person only hid in the window are included; disabled ones are not. `omitted` counts boards beyond the limit.',
      inputSchema: {
        limit: z.number().int().min(1).max(BOARD_LIMIT.max).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        return mcpSuccess(await listBoards(context, params));
      } catch (err) {
        return mcpErrorFrom(err);
      }
    },
  );

  server.registerTool(
    'cards_list',
    {
      title: 'List the cards of a board',
      description:
        'Cards of one board with `version` (hand it back to cards_move), lane (backlog, todo, in-progress, done, unassigned), source column, assignees, due and url; no descriptions. Sorted by lane, due (none last), title. Own cards only by default (the configured filter); `mine: "all"` lifts that. Done cards only with `includeDone`. `omitted` counts cards beyond the limit.',
      inputSchema: {
        board: z.string().describe('Board id from boards_list'),
        source: z.string().optional().describe('Source id, only when two sources share the board id'),
        mine: z.enum(MINE_FILTERS).optional().describe('assigned, watching or all'),
        includeDone: z.boolean().optional().describe('Include cards in the done lane'),
        limit: z.number().int().min(1).max(CARD_LIMIT.max).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        return mcpSuccess(await listBoardCards(context, params));
      } catch (err) {
        return mcpErrorFrom(err);
      }
    },
  );

  // The only board write on the MCP surface (docs/adr/0013 §9): create and update stay out.
  server.registerTool(
    'cards_move',
    requiresCapability(
      {
        title: 'Move a card on a board',
        description:
          'Move one card to another column of its board, in a board the config grants `board.move` for (target "<source>:<board>"). Identify the card with source, board and id from cards_list and pass its `version` unchanged; a card someone else changed since is a conflict error and nothing is written. Name the target as `column` (a source column) or `lane` (only where one column maps onto it), not both. `position` is optional. Answers the card as the source has it afterwards. The tool is only served when a board.move grant exists.',
        inputSchema: {
          source: z.string().min(1).describe('Source id from boards_list'),
          board: z.string().min(1).describe('Board id from boards_list'),
          id: z.string().min(1).describe('Card id from cards_list'),
          version: z
            .string()
            .nullable()
            .describe('The card’s `version` from cards_list; null only if it was null there'),
          column: z.string().min(1).optional().describe('Target source column, e.g. "Doing"'),
          lane: z.enum(BOARD_LANES).optional().describe('Target lane: backlog, todo, in-progress or done'),
          position: z.number().int().min(0).optional().describe('Place inside the column, 0 = top'),
        },
        annotations: { readOnlyHint: false, openWorldHint: false },
      },
      {
        capability: 'board.move',
        targetOf: (args: { source: string; board: string }) => boardTarget(args.source, args.board),
      },
    ),
    async (params) => {
      try {
        return mcpSuccess(await moveBoardCard(context, params));
      } catch (err) {
        return mcpErrorFrom(err);
      }
    },
  );
}
