/**
 * `reminder config` — where the file is and whether it parses. Prints counts, not contents: the
 * output ends up in bug reports.
 */

import type { CommandModule } from 'yargs';

import { _, fmt } from '@reminder/core';
import { configPath, loadConfig } from '../../core/config.ts';
import { pickArgv, printJson, runAndExit } from './output.ts';

export const configCommand: CommandModule = {
  command: 'config',
  describe: _('Show the config file path and validate it'),
  builder: (yargs) => yargs.option('json', { type: 'boolean', default: false }),
  handler: (argv) => {
    const asJson = pickArgv<boolean>(argv as Record<string, unknown>, 'json') ?? false;
    runAndExit(
      async () => {
        const path = configPath();
        const config = loadConfig(path);
        return {
          path,
          backend: config.backend,
          grants: config.grants.length,
          routes: config.routes.length,
          defaults: Object.keys(config.defaults),
        };
      },
      (summary) => {
        if (asJson) return printJson(summary);
        console.log(summary.path);
        console.log(
          fmt(_('backend {backend} · {grants} grants · {routes} routes · defaults: {defaults}'), {
            backend: summary.backend,
            grants: summary.grants,
            routes: summary.routes,
            defaults: summary.defaults.join(', ') || _('none'),
          }),
        );
      },
    );
  },
};
