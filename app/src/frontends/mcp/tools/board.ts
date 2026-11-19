/**
 * The board read tools (docs/adr/0007, 0008). Read-only: no grant, no write path. Caps come from
 * limits.ts; `omitted` says how many matches the cap cut off. Rows carry no description.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { mcpErrorFrom, mcpSuccess } from '@gjsify/mcp';
import { BOARD_LIMIT, CARD_LIMIT, MINE_FILTERS } from '@reminder/core';
import { z } from 'zod';

import { listBoardCards, listBoards } from '../../../core/board-read.ts';
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
        'Cards of one board with lane (backlog, todo, in-progress, done, unassigned), source column, assignees, due and url; no descriptions. Sorted by lane, due (none last), title. Own cards only by default (the configured filter); `mine: "all"` lifts that. Done cards only with `includeDone`. `omitted` counts cards beyond the limit.',
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
}
