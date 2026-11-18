/**
 * `reminder accounts` — the configured accounts (docs/adr/0005) with their backend and how much
 * each one serves. Counts, not contents: like `reminder config`, this output ends up in bug
 * reports, so no calendar names, no uids and no credentials.
 *
 * An account that cannot be reached is reported on its own line instead of ending the command: a
 * diagnostic that dies on the first problem cannot show the second one.
 */

import type { CommandModule } from 'yargs';

import { _, errorMessage, fmt } from '@reminder/core';

import { loadConfig } from '../../core/config.ts';
import { createAccountBackend } from '../../core/context.ts';
import { dim, pickArgv, printJson, runAndExit } from './output.ts';

interface AccountSummary {
  id: string;
  backend: string;
  /** Null when the account could not be reached — see `error`. */
  calendars: number | null;
  lists: number | null;
  error: string | null;
}

export const accountsCommand: CommandModule = {
  command: 'accounts',
  describe: _('List the configured accounts'),
  builder: (yargs) => yargs.option('json', { type: 'boolean', default: false }),
  handler: (argv) => {
    const asJson = pickArgv<boolean>(argv as Record<string, unknown>, 'json') ?? false;
    runAndExit(
      async () => {
        const config = loadConfig();
        const named = config.accounts.length > 1;
        const summaries: AccountSummary[] = [];
        for (const account of config.accounts) {
          const base = { id: account.id, backend: account.backend };
          try {
            const backend = createAccountBackend(account, process.env, named);
            const calendars = await backend.listCalendars();
            summaries.push({
              ...base,
              calendars: calendars.filter((c) => c.kind === 'event').length,
              lists: calendars.filter((c) => c.kind === 'reminder').length,
              error: null,
            });
          } catch (err) {
            summaries.push({ ...base, calendars: null, lists: null, error: errorMessage(err) });
          }
        }
        return summaries;
      },
      (accounts) => {
        if (asJson) return printJson(accounts);
        for (const a of accounts) {
          console.log(`${a.id.padEnd(16)} ${a.backend}`);
          console.log(
            dim(
              `                 ${
                a.error === null
                  ? fmt(_('{calendars} calendars · {lists} task lists'), {
                      calendars: a.calendars ?? 0,
                      lists: a.lists ?? 0,
                    })
                  : a.error
              }`,
            ),
          );
        }
      },
    );
  },
};
