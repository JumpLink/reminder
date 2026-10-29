/**
 * `reminder calendars` — every enabled calendar and task list, with the uid a grant or a route
 * names.
 */

import type { CommandModule } from 'yargs';

import { _, type ItemKind } from '@reminder/core';

import { createContext } from '../../core/context.ts';
import { dim, pickArgv, printJson, runAndExit } from './output.ts';

export const calendarsCommand: CommandModule = {
  command: 'calendars',
  describe: _('List calendars and task lists'),
  builder: (yargs) =>
    yargs
      .option('kind', {
        type: 'string',
        choices: ['event', 'reminder'],
        describe: _('Only calendars or only task lists'),
      })
      .option('json', { type: 'boolean', default: false }),
  handler: (argv) => {
    const raw = argv as Record<string, unknown>;
    const kind = pickArgv<ItemKind>(raw, 'kind');
    const asJson = pickArgv<boolean>(raw, 'json') ?? false;
    runAndExit(
      () => createContext().backend().listCalendars(kind),
      (calendars) => {
        if (asJson) return printJson(calendars);
        if (calendars.length === 0) return console.log(_('No enabled calendars or task lists.'));
        for (const c of calendars) {
          const account = c.account ? dim(` · ${c.account}`) : '';
          console.log(`${(c.kind === 'event' ? _('event') : _('reminder')).padEnd(10)} ${c.name}${account}`);
          console.log(dim(`          ${c.uid}`));
        }
      },
    );
  },
};
