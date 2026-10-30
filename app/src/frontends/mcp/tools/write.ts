/**
 * The two write tools — creating an event and creating a reminder (ADR 0001 §4/§5).
 *
 * Two lines guard them, deliberately independent of each other:
 *
 * - `applyGrantGate` (in server.ts) decides at REGISTRATION whether the tool is served at all, and
 *   repeats the exact-target check on every call from `targetOf`. It reads the config's grants, so
 *   a capability without a grant is a missing tool.
 * - `createEvent` / `createReminder` check the same grant again inside the only code that writes.
 *   The CLI and any later UI go through there too, so the two frontends cannot drift.
 *
 * `targetOf` resolves the target exactly as the action will (explicit calendar → route → default),
 * against the same config object the context hands to the action. A call the action would refuse
 * with `RoutingError` is therefore refused by the gate already.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { mcpErrorFrom, mcpSuccess, requiresCapability } from '@gjsify/mcp';
import {
  createCapability,
  createEvent,
  createReminder,
  resolveTarget,
  type ItemKind,
  type ReminderConfig,
} from '@reminder/core';
import { z } from 'zod';

import type { Context } from '../../../core/context.ts';

/** The target this call will write to, resolved the way the action resolves it. */
function targetOfCall(config: ReminderConfig, kind: ItemKind, args: { calendar?: string; concern?: string }) {
  return resolveTarget(config, { kind, calendar: args.calendar, concern: args.concern });
}

const calendar = z
  .string()
  .min(1)
  .optional()
  .describe('Calendar uid from calendars_list. Wins over concern; a grant must name exactly this uid');
const concern = z
  .string()
  .min(1)
  .optional()
  .describe('What the item is about; routed through the config, then defaults[kind]');
const source = z
  .string()
  .min(1)
  .describe('Where the item came from, e.g. mail (letters, digits, . _ - only)');
const sourceId = z
  .string()
  .min(1)
  .describe('That origin’s own id, e.g. the Message-ID; source + sourceId is the dedupe key');
const summary = z.string().min(1).describe('Title');
const description = z.string().min(1).optional();

export function registerWriteTools(server: McpServer, context: Context): void {
  server.registerTool(
    'events_create',
    requiresCapability(
      {
        title: 'Create an event',
        description:
          'Create one event in a calendar the config grants `calendar.create` for, at the exact uid. Needs `source` + `sourceId`: the same pair always maps to the same UID, so repeating a call returns `created: false` instead of a second event; a different pair on an existing UID is an error, never a merge. Times: YYYY-MM-DD is all-day, otherwise ISO-8601 with an offset or Z. `calendar` wins over `concern`; without either the routes and defaults decide. The tool is only served when a matching grant exists.',
        inputSchema: {
          calendar,
          concern,
          source,
          sourceId,
          summary,
          description,
          start: z.string().min(1).describe('YYYY-MM-DD for all-day, otherwise ISO-8601 with offset or Z'),
          end: z
            .string()
            .min(1)
            .optional()
            .describe('YYYY-MM-DD or ISO-8601; all-day events default to one day'),
          location: z.string().min(1).optional(),
        },
        annotations: { readOnlyHint: false, openWorldHint: false },
      },
      {
        capability: createCapability('event'),
        targetOf: (args: { calendar?: string; concern?: string }) =>
          targetOfCall(context.config(), 'event', args),
      },
    ),
    async (params) => {
      try {
        return mcpSuccess(
          await createEvent({ backend: context.backend(), config: context.config() }, params),
        );
      } catch (err) {
        return mcpErrorFrom(err);
      }
    },
  );

  server.registerTool(
    'reminders_create',
    requiresCapability(
      {
        title: 'Create a reminder (task)',
        description:
          'Create one reminder (VTODO) in a task list the config grants `reminder.create` for, at the exact uid. Needs `source` + `sourceId`: the same pair always maps to the same UID, so repeating a call returns `created: false` instead of a second reminder; a different pair on an existing UID is an error, never a merge. `calendar` wins over `concern`; without either the routes and defaults decide. `due` is YYYY-MM-DD or ISO-8601 with an offset or Z. The tool is only served when a matching grant exists.',
        inputSchema: {
          calendar,
          concern,
          source,
          sourceId,
          summary,
          description,
          due: z.string().min(1).optional().describe('YYYY-MM-DD or ISO-8601 with offset or Z'),
        },
        annotations: { readOnlyHint: false, openWorldHint: false },
      },
      {
        capability: createCapability('reminder'),
        targetOf: (args: { calendar?: string; concern?: string }) =>
          targetOfCall(context.config(), 'reminder', args),
      },
    ),
    async (params) => {
      try {
        return mcpSuccess(
          await createReminder({ backend: context.backend(), config: context.config() }, params),
        );
      } catch (err) {
        return mcpErrorFrom(err);
      }
    },
  );
}
