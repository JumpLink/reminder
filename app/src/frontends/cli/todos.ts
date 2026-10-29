/**
 * `reminder todos` — reminders from every task list, open ones only by default, by due date.
 */

import type { CommandModule } from 'yargs';

import { _, fmt, listReminders, REMINDER_LIMIT } from '@reminder/core';

import { createContext } from '../../core/context.ts';
import { dim, omittedLine, pickArgv, printJson, runAndExit, shortTime } from './output.ts';

export const todosCommand: CommandModule = {
  command: 'todos',
  describe: _('List reminders (tasks)'),
  builder: (yargs) =>
    yargs
      .option('all', {
        type: 'boolean',
        default: false,
        describe: _('Include completed and cancelled reminders'),
      })
      .option('calendar', { type: 'string', describe: _('One task list uid (see `reminder calendars`)') })
      .option('limit', {
        type: 'number',
        describe: fmt(_('Max reminders (default {default}, max {max})'), {
          default: REMINDER_LIMIT.default,
          max: REMINDER_LIMIT.max,
        }),
      })
      .option('json', { type: 'boolean', default: false }),
  handler: (argv) => {
    const raw = argv as Record<string, unknown>;
    const asJson = pickArgv<boolean>(raw, 'json') ?? false;
    runAndExit(
      () =>
        listReminders(createContext().backend(), {
          all: pickArgv<boolean>(raw, 'all'),
          calendar: pickArgv<string>(raw, 'calendar'),
          limit: pickArgv<number>(raw, 'limit'),
        }),
      (result) => {
        if (asJson) return printJson(result);
        if (result.reminders.length === 0) console.log(_('No open reminders.'));
        for (const r of result.reminders) {
          const box = r.status === 'completed' ? '[x]' : r.status === 'cancelled' ? '[-]' : '[ ]';
          const due = r.due ? dim(fmt(_('  due {time}'), { time: shortTime(r.due) })) : '';
          console.log(`${box} ${r.summary ?? _('(no title)')}${due}`);
        }
        const more = omittedLine(result.omitted, '--limit');
        if (more) console.log(more);
      },
    );
  },
};
