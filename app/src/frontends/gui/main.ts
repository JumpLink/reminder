/**
 * The GTK4/libadwaita frontend — entry point of `reminder gui`.
 *
 * Loaded lazily by the yargs command, so the CLI and the MCP server never import Gtk (a terminal
 * run without a display would fail on it). `runAdwaitaApp` owns the `runAsync` lifecycle, the
 * `app.quit` (Ctrl+Q) and `app.about` actions and the env-gated devtools control plane.
 */

import Gtk from '@girs/gtk-4.0';
import system from 'system';
import { AdwaitaApp, readAppDevHooks, runApplication } from '@gjsify/adwaita-app';

import { _ } from '@reminder/core';

import { APP_ID, APP_NAME, APP_VERSION, DEV_HOOK_PREFIX, SIZE_HOOK } from './constants.ts';
import { MainWindow } from './window.ts';

// Pin GTK 4 before libadwaita pulls it in; keep the import referenced.
void Gtk;

function readSize(): [number, number] | undefined {
  const [w, h] = (process.env[SIZE_HOOK] ?? '').split(/\s+/).map(Number);
  return w > 0 && h > 0 ? [w, h] : undefined;
}

export async function runGui(): Promise<number> {
  const hooks = readAppDevHooks({ prefix: DEV_HOOK_PREFIX });
  const app = new AdwaitaApp({
    applicationId: APP_ID,
    about: {
      applicationName: APP_NAME,
      applicationIcon: APP_ID,
      developerName: 'JumpLink',
      version: APP_VERSION,
      website: 'https://github.com/JumpLink/reminder',
      issueUrl: 'https://github.com/JumpLink/reminder/issues',
      license: 'AGPL-3.0-or-later',
      comments: _('Calendar events and reminders from your existing calendars.'),
    },
    createWindow: (app) => new MainWindow(app, { view: hooks.view, size: readSize() }),
  });
  // `runAdwaitaApp` forwards `gui` (the yargs subcommand) as an argument, which GApplication
  // reads as a file to open and refuses; only the program name goes in.
  const done = runApplication(app, [system.programInvocationName]);
  // Run inside the MainLoop that src/index.ts already iterates, `runAsync` registers the app but
  // never emits `activate` (measured: `startup` fires, no window). Activate it by hand once.
  // gjsify gap: report upstream, drop this when `runAdwaitaApp` activates under a running loop.
  setTimeout(() => app.activate(), 0);
  return done;
}
