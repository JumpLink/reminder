/**
 * The write tools — creating an event, creating a reminder (ADR 0001 §4/§5) and changing one
 * that exists (ADR 0003).
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
  updateReminder,
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

  // One tool, not a second `reminders_complete`: completing is `status: "completed"`, and a
  // separate tool would be a second name for the same capability, the same target check and the
  // same write — one more thing a model has to choose between for no gain.
  server.registerTool(
    'reminders_update',
    requiresCapability(
      {
        title: 'Change a reminder (task)',
        description:
          'Change one existing reminder (VTODO) in a task list the config grants `reminder.update` for, at the exact uid. Identify it by `uid` from reminders_list. Only the fields given are changed; everything else in the stored task, including properties this tool does not model (alarms, recurrence, categories), is left as it is. `null` clears `description` and `due`, `priority: 0` clears the priority. `status: "completed"` also stamps COMPLETED and PERCENT-COMPLETE 100; `"needs-action"` reopens and removes both. Without `calendar` the default task list is used. On CalDAV a concurrent change by another client makes this fail rather than overwrite it — re-read and retry. The tool is only served when a matching grant exists.',
        inputSchema: {
          calendar: z
            .string()
            .min(1)
            .optional()
            .describe('Task list uid from calendars_list; a grant must name exactly this uid'),
          uid: z.string().min(1).describe('The reminder’s UID, as reminders_list reports it'),
          summary,
          description: z.string().nullable().optional().describe('null removes the description'),
          due: z
            .string()
            .min(1)
            .nullable()
            .optional()
            .describe('YYYY-MM-DD or ISO-8601 with offset or Z; null removes the due date'),
          priority: z.number().int().min(0).max(9).optional().describe('1 (highest) to 9, 0 for none'),
          status: z.enum(['needs-action', 'in-process', 'completed', 'cancelled']).optional(),
        },
        annotations: { readOnlyHint: false, openWorldHint: false },
      },
      {
        capability: 'reminder.update',
        targetOf: (args: { calendar?: string }) => targetOfCall(context.config(), 'reminder', args),
      },
    ),
    async (params) => {
      try {
        const { description: newDescription, due, ...rest } = params;
        return mcpSuccess(
          await updateReminder(
            { backend: context.backend(), config: context.config() },
            {
              ...rest,
              // The core clears with an empty string; JSON has null for "no value", so the two
              // spellings meet here rather than in the core.
              ...(newDescription === undefined ? {} : { description: newDescription ?? '' }),
              ...(due === undefined ? {} : { due: due ?? '' }),
            },
          ),
        );
      } catch (err) {
        return mcpErrorFrom(err);
      }
    },
  );
}
