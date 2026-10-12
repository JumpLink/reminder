/**
 * The read tools. Limits come from `@reminder/core`'s limits.ts, so the schema's `.max()` and the
 * action's clamp are the same number.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { mcpErrorFrom, mcpSuccess } from '@gjsify/mcp';
import {
  EVENT_LIMIT,
  EVENT_WINDOW_DAYS,
  listEvents,
  listPriorities,
  listReminders,
  PRIORITY_LIMIT,
  REMINDER_LIMIT,
} from '@reminder/core';
import { z } from 'zod';

import type { Context } from '../../../core/context.ts';

export function registerReadTools(server: McpServer, context: Context): void {
  server.registerTool(
    'calendars_list',
    {
      title: 'List calendars and task lists',
      description:
        'Every enabled calendar (events) and task list (reminders) with its uid, display name, kind and account. The uid is what the other tools take as `calendar`.',
      inputSchema: {
        kind: z
          .enum(['event', 'reminder'])
          .optional()
          .describe('Only calendars (event) or only task lists (reminder)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        const calendars = await context.backend().listCalendars(params.kind);
        return mcpSuccess({ count: calendars.length, calendars });
      } catch (err) {
        return mcpErrorFrom(err);
      }
    },
  );

  server.registerTool(
    'events_list',
    {
      title: 'List events in a time window',
      description: `Events with an occurrence in [from, to], sorted by start. A recurring event comes back once, as its series definition. Times: YYYY-MM-DD is all-day, a trailing Z is UTC, no zone is floating local time. Default window: today (UTC) + ${EVENT_WINDOW_DAYS} days. \`omitted\` counts matches beyond the limit.`,
      inputSchema: {
        from: z.string().optional().describe('YYYY-MM-DD or ISO-8601 time; default today (UTC)'),
        to: z.string().optional().describe('YYYY-MM-DD (inclusive) or ISO-8601 time'),
        calendar: z.string().optional().describe('One calendar uid from calendars_list'),
        limit: z.number().int().min(1).max(EVENT_LIMIT.max).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        return mcpSuccess(await listEvents(context.backend(), params));
      } catch (err) {
        return mcpErrorFrom(err);
      }
    },
  );

  server.registerTool(
    'reminders_list',
    {
      title: 'List reminders (tasks)',
      description:
        'Reminders (VTODO) from every task list, by due date, undated ones last. Open ones only unless `all` is true. `omitted` counts matches beyond the limit.',
      inputSchema: {
        calendar: z.string().optional().describe('One task list uid from calendars_list'),
        all: z.boolean().optional().describe('Include completed and cancelled reminders'),
        limit: z.number().int().min(1).max(REMINDER_LIMIT.max).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        return mcpSuccess(await listReminders(context.backend(), params));
      } catch (err) {
        return mcpErrorFrom(err);
      }
    },
  );

  server.registerTool(
    'priorities_list',
    {
      title: 'List priorities with their open steps',
      description:
        'The ranked priorities from the configured task list (`priorities.list`): lowest PRIORITY value first, then earliest DUE (none last), then oldest. The first entry is the top priority; `tie` is true on items sharing that lowest value. Each has `daysToDeadline` (negative = overdue), `daysOpen` (age of its oldest open step), `link` (case file URL, verbatim) and its open `steps`, oldest first; `nag` marks the oldest step, the one to chase. `today` is the local date every day count used. Errors when no list is configured. `omitted` counts matches beyond the limit.',
      inputSchema: {
        limit: z.number().int().min(1).max(PRIORITY_LIMIT.max).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (params) => {
      try {
        return mcpSuccess(
          await listPriorities(context.backend(), {
            list: context.config().priorities.list,
            limit: params.limit,
          }),
        );
      } catch (err) {
        return mcpErrorFrom(err);
      }
    },
  );
}
