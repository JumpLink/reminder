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

import { _, errorMessage } from '@reminder/core';

import { createContext } from '../../core/context.ts';

import { APP_ID, APP_NAME, APP_VERSION, DEV_HOOK_PREFIX, SIZE_HOOK } from './constants.ts';
import { createTasksModel } from './model.ts';
import { createGuiSettings } from './settings.ts';
import { createGuiSync } from './sync.ts';
import { MainWindow } from './window.ts';

// Pin GTK 4 before libadwaita pulls it in; keep the import referenced.
void Gtk;

function readSize(): [number, number] | undefined {
  const [w, h] = (process.env[SIZE_HOOK] ?? '').split(/\s+/).map(Number);
  return w > 0 && h > 0 ? [w, h] : undefined;
}

/** Config, secrets, sync and model — after the window exists, so a slow server never delays it. */
async function startServices(window: MainWindow): Promise<void> {
  try {
    const context = createContext();
    const config = context.config();
    const sync = await createGuiSync(context);
    if (sync.backend === null) {
      window.showError(sync.problems.join('\n') || _('No calendar backend could be set up.'));
      return;
    }
    const model = createTasksModel({ config, backend: sync.backend, service: sync.service });
    window.attach({ model, settings: createGuiSettings(), service: sync.service, problems: sync.problems });
    await model.load();
    await sync.service.start();
  } catch (err) {
    window.showError(errorMessage(err));
  }
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
    createWindow: (app) => {
      const window = new MainWindow(app, { view: hooks.view, size: readSize() });
      void startServices(window);
      return window;
    },
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
