/**
 * The create tools. Each declares its capability with `requiresCapability`; `applyGrantGate`
 * (server.ts) registers it only when a grant for that capability exists and runs the check before
 * the handler. The target is resolved here the way the core resolves it, so the gate and
 * `createEvent` / `createReminder` can never disagree about where an item would go. The core checks
 * the grant again — the gate is a second lock, not the only one.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { mcpErrorFrom, mcpSuccess, requiresCapability } from '@gjsify/mcp';
import { createEvent, createReminder, resolveTarget, type CreateResult, type ItemKind } from '@reminder/core';
import { z } from 'zod';

import type { Context } from '../../../core/context.ts';

interface TargetArgs {
  calendar?: string;
  concern?: string;
}

const common = {
  summary: z.string().min(1).describe('Title of the item'),
  description: z.string().optional(),
  calendar: z
    .string()
    .optional()
    .describe('Calendar / task list uid from calendars_list. Wins over `concern`.'),
  concern: z
    .string()
    .optional()
    .describe('What the item is about; routed to a calendar by the configured routes'),
  source: z.string().min(1).describe('Where the item came from, e.g. "mail"'),
  sourceId: z
    .string()
    .min(1)
    .describe("That origin's own id, e.g. a Message-ID. Same source + sourceId never creates twice."),
};

const WHERE =
  'The target is `calendar`, else the route for `concern`, else the configured default; with none of them the call is refused, so pass `calendar` when unsure.';

function targetOf(context: Context, kind: ItemKind) {
  return (args: TargetArgs): string =>
    resolveTarget(context.config(), { kind, calendar: args.calendar, concern: args.concern });
}

function answer(result: CreateResult) {
  return mcpSuccess({ status: result.created ? 'created' : 'already-exists', ...result });
}

export function registerCreateTools(server: McpServer, context: Context): void {
  server.registerTool(
    'events_create',
    requiresCapability(
      {
        title: 'Create a calendar event',
        description: `Add an event (VEVENT). Idempotent: a second call with the same source + sourceId returns the existing uid with status "already-exists" and writes nothing. start/end: YYYY-MM-DD makes an all-day event (end then must be a date too), otherwise ISO-8601 with an offset or Z. ${WHERE}`,
        inputSchema: {
          ...common,
          start: z.string().describe('YYYY-MM-DD (all-day) or ISO-8601 with offset or Z'),
          end: z.string().optional().describe('Same form as start'),
          location: z.string().optional(),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      { capability: 'calendar.create', targetOf: targetOf(context, 'event') },
    ),
    async (params) => {
      try {
        return answer(await createEvent({ backend: context.backend(), config: context.config() }, params));
      } catch (err) {
        return mcpErrorFrom(err);
      }
    },
  );

  server.registerTool(
    'reminders_create',
    requiresCapability(
      {
        title: 'Create a reminder',
        description: `Add a reminder (VTODO). Idempotent: a second call with the same source + sourceId returns the existing uid with status "already-exists" and writes nothing. ${WHERE}`,
        inputSchema: {
          ...common,
          due: z.string().optional().describe('YYYY-MM-DD or ISO-8601 with offset or Z'),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      { capability: 'reminder.create', targetOf: targetOf(context, 'reminder') },
    ),
    async (params) => {
      try {
        return answer(await createReminder({ backend: context.backend(), config: context.config() }, params));
      } catch (err) {
        return mcpErrorFrom(err);
      }
    },
  );
}
