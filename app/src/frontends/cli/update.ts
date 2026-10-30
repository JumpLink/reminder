/**
 * `reminder update` / `complete` / `reopen` — changing a reminder that already exists.
 *
 * Three commands rather than one with a `--status` only: closing a task is what one actually does
 * all day, and `reminder complete <uid>` is the whole command for it. `update` is the general form
 * and can set the two statuses the other two do not cover.
 *
 * An option that is not given is not changed. An empty value clears the property where clearing
 * is meaningful (`--due ''`, `--description ''`, `--priority 0`), so there is no second spelling
 * for "remove this".
 */

import type { CommandModule } from 'yargs';

import { _, fmt, isWritableStatus, updateReminder, type ReminderChanges } from '@reminder/core';

import { createContext } from '../../core/context.ts';
import { pickArgv, printJson, reminderLine, runAndExit } from './output.ts';

const calendarOption = {
  type: 'string',
  describe: _('Task list uid (see `reminder calendars`); the default list otherwise'),
} as const;

function apply(raw: Record<string, unknown>, changes: ReminderChanges): void {
  const asJson = pickArgv<boolean>(raw, 'json') ?? false;
  const context = createContext();
  runAndExit(
    () =>
      updateReminder(
        { backend: context.backend(), config: context.config() },
        {
          calendar: pickArgv<string>(raw, 'calendar'),
          uid: pickArgv<string>(raw, 'uid') ?? '',
          ...changes,
        },
      ),
    (result) => {
      if (asJson) return printJson(result);
      if (result.reminder) console.log(reminderLine(result.reminder));
      else console.log(fmt(_('Updated {uid}.'), { uid: result.uid }));
    },
  );
}

export const updateCommand: CommandModule = {
  command: 'update <uid>',
  describe: _('Change a reminder (title, description, due date, priority, status)'),
  builder: (yargs) =>
    yargs
      .positional('uid', { type: 'string', describe: _('The reminder UID (see `reminder todos --json`)') })
      .option('calendar', calendarOption)
      .option('summary', { type: 'string', describe: _('New title') })
      .option('description', { type: 'string', describe: _('New description; empty clears it') })
      .option('due', {
        type: 'string',
        describe: _('New due date: YYYY-MM-DD or ISO-8601 with offset or Z; empty clears it'),
      })
      .option('priority', { type: 'number', describe: _('1 (highest) to 9; 0 clears it') })
      .option('status', {
        type: 'string',
        choices: ['needs-action', 'in-process', 'completed', 'cancelled'],
        describe: _('New status'),
      })
      .option('json', { type: 'boolean', default: false }),
  handler: (argv) => {
    const raw = argv as Record<string, unknown>;
    const status = pickArgv<string>(raw, 'status');
    apply(raw, {
      ...pick('summary', pickArgv<string>(raw, 'summary')),
      ...pick('description', pickArgv<string>(raw, 'description')),
      ...pick('due', pickArgv<string>(raw, 'due')),
      ...pick('priority', pickArgv<number>(raw, 'priority')),
      ...(status !== undefined && isWritableStatus(status) ? { status } : {}),
    });
  },
};

export const completeCommand: CommandModule = {
  command: 'complete <uid>',
  describe: _('Mark a reminder as done'),
  builder: (yargs) =>
    yargs
      .positional('uid', { type: 'string', describe: _('The reminder UID (see `reminder todos --json`)') })
      .option('calendar', calendarOption)
      .option('json', { type: 'boolean', default: false }),
  handler: (argv) => apply(argv as Record<string, unknown>, { status: 'completed' }),
};

export const reopenCommand: CommandModule = {
  command: 'reopen <uid>',
  describe: _('Mark a done reminder as open again'),
  builder: (yargs) =>
    yargs
      .positional('uid', { type: 'string', describe: _('The reminder UID (see `reminder todos --json`)') })
      .option('calendar', calendarOption)
      .option('json', { type: 'boolean', default: false }),
  handler: (argv) => apply(argv as Record<string, unknown>, { status: 'needs-action' }),
};

/** `{ key: value }` when the option was given at all, `{}` otherwise — `''` and `0` are values. */
function pick<K extends string, V>(key: K, value: V | undefined): Record<K, V> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}
