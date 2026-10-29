import './core/i18n-init.ts';

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { _ } from '@reminder/core';

import { uiLanguage } from './core/i18n.ts';
import { VERSION } from './core/runtime.ts';
import {
  calendarsCommand,
  configCommand,
  eventsCommand,
  mcpCommand,
  prioritiesCommand,
  todosCommand,
} from './frontends/cli/index.ts';

function reportError(err: unknown): void {
  // With `.fail(false)` yargs prints no usage dump of its own, so every error surfaces here once.
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}

const parseArgs = () =>
  yargs(hideBin(process.argv))
    .command(calendarsCommand)
    .command(eventsCommand)
    .command(todosCommand)
    .command(prioritiesCommand)
    .command(configCommand)
    .command(mcpCommand)
    .demandCommand(1, _('Give a command — `reminder --help` lists them.'))
    // An unmatched command would leave the GJS main loop running forever.
    .strictCommands()
    .scriptName('reminder')
    // Pin the locale to the catalogue's language: yargs otherwise translates its own chrome from
    // $LANG, which can disagree with the describe strings (catalogue missing, or LANGUAGE set).
    .locale(uiLanguage())
    .version(VERSION)
    .help()
    .fail(false)
    .exitProcess(false)
    .parseAsync();

// yargs can throw synchronously for some demandCommand failures instead of rejecting. On GJS that
// surfaces as "Module threw an exception"; normalise it to a rejection.
let parsed: ReturnType<typeof parseArgs>;
try {
  parsed = parseArgs();
} catch (err) {
  parsed = Promise.reject(err);
}

// Inlined rather than imported from core/runtime.ts' runningOnGjs() because the loop decision is
// the first thing that must hold.
const runningOnGjs = typeof (globalThis as { imports?: unknown }).imports !== 'undefined';

if (runningOnGjs) {
  // GJS has no always-on event loop. Commands exit themselves via process.exit() when their work
  // is done (runAndExit; serveStdio for `mcp`), so the loop runs until then. We only step in where
  // nothing else exits: a parse error, and yargs' own --help / --version.
  const GLib = (
    globalThis as unknown as {
      imports: { gi: { GLib: { MainLoop: new (ctx: unknown, running: boolean) => { run(): void } } } };
    }
  ).imports.gi.GLib;
  const loop = new GLib.MainLoop(null, false);
  parsed.then(
    (argv) => {
      const a = argv as Record<string, unknown> | undefined;
      if (a?.help || a?.version) process.exit(typeof process.exitCode === 'number' ? process.exitCode : 0);
    },
    (err: unknown) => {
      reportError(err);
      process.exit(typeof process.exitCode === 'number' ? process.exitCode : 1);
    },
  );
  loop.run();
} else {
  parsed.catch(reportError);
}
