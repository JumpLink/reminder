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
import { initI18n as initWidgetI18n } from '@gjsify/adwaita-extended';

import { _, errorMessage } from '@reminder/core';

import { configPath } from '../../core/config.ts';
import { createConfigStore } from '../../core/config-write.ts';
import { createContext, type Context } from '../../core/context.ts';
import { defaultLocaleDir } from '../../core/i18n.ts';
import { createDemoContext, demoActive, demoConfig } from '../../core/demo/index.ts';

import {
  APP_ID,
  APP_NAME,
  APP_VERSION,
  CALENDAR_MODE_HOOK,
  CARD_HOOK,
  DEV_HOOK_PREFIX,
  PREFS_HOOK,
  SCHEME_HOOK,
  SIZE_HOOK,
} from './constants.ts';
import { createBoardModel } from './board-model.ts';
import { createCalendarModel } from './calendar-model.ts';
import { createTasksModel } from './model.ts';
import { COLOR_SCHEMES, createGuiSettings, createMemorySettings, type ColorScheme } from './settings.ts';
import { createGuiSync, type GuiSync } from './sync.ts';
import { applyColorScheme, presentPreferences } from './views/preferences/index.ts';
import type { PreferencesEnv } from './views/preferences/controller.ts';
import { MainWindow } from './window.ts';

// Pin GTK 4 before libadwaita pulls it in; keep the import referenced.
void Gtk;

/** The colour scheme the dev hook asks for, or null when it names none the app knows. */
function schemeHook(): ColorScheme | null {
  const value = process.env[SCHEME_HOOK];
  return COLOR_SCHEMES.includes(value as ColorScheme) ? (value as ColorScheme) : null;
}

function readSize(): [number, number] | undefined {
  const [w, h] = (process.env[SIZE_HOOK] ?? '').split(/\s+/).map(Number);
  return w > 0 && h > 0 ? [w, h] : undefined;
}

/**
 * Config, secrets, sync and model — after the window exists, so a slow server never delays it.
 * Runs again after every configuration change from the preferences: the old service stops and a
 * new one starts from the saved config (a re-enabled source is fetched by that start).
 */
function createServices(window: MainWindow) {
  const demo = demoActive();
  const store = createConfigStore({ demo, path: configPath(), demoConfig });
  const settings = demo ? createMemorySettings() : createGuiSettings();
  let context: Context | null = null;
  let current: GuiSync | null = null;

  const start = async (): Promise<void> => {
    current?.service.stop();
    const config = store.read();
    context = demo ? createDemoContext(new Date(), config) : createContext();
    const sync = await createGuiSync(context);
    current = sync;
    if (sync.backend === null) {
      window.showError(sync.problems.join('\n') || _('No calendar backend could be set up.'));
      return;
    }
    const model = createTasksModel({
      config: context.config(),
      backend: sync.backend,
      service: sync.service,
    });
    const board = createBoardModel({
      boards: sync.boards,
      service: sync.service,
      config: context.config(),
      problems: sync.boardProblems,
      hidden: settings.hidden(),
    });
    const calendar = createCalendarModel({ backend: sync.backend });
    window.attach({
      model,
      board,
      calendar,
      settings,
      service: sync.service,
      problems: sync.problems,
    });
    await model.load();
    await sync.service.start();
  };

  const env: PreferencesEnv = {
    store,
    settings,
    secrets: () => (context ?? createContext()).secrets(),
    cache: () => (context ?? createContext()).cache(),
    lists: () => current?.lists ?? [],
    failures: () => current?.failures ?? new Map(),
    boards: () => current?.boards ?? [],
    boardProblems: () => current?.boardProblems ?? [],
    rebuild: start,
  };
  window.onPreferences = () => presentPreferences(window, env, demo);
  applyColorScheme(schemeHook() ?? settings.colorScheme());
  return { start, open: (page?: string) => presentPreferences(window, env, demo, page) };
}

async function startServices(window: MainWindow): Promise<void> {
  try {
    const services = createServices(window);
    await services.start();
    const page = process.env[PREFS_HOOK];
    if (page) services.open(page);
    // After `start`, so the first sync has filled the board the hook wants a card from.
    if (process.env[CARD_HOOK]) window.openFirstCard();
  } catch (err) {
    window.showError(errorMessage(err));
  }
}

export async function runGui(): Promise<number> {
  // The widgets bind their own domain on load; point it at the catalogue the app ships beside its own.
  initWidgetI18n(defaultLocaleDir());
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
      const window = new MainWindow(app, {
        view: hooks.view,
        size: readSize(),
        demo: demoActive(),
        calendarMode: process.env[CALENDAR_MODE_HOOK],
      });
      void startServices(window);
      return window;
    },
  });
  // `runAdwaitaApp` forwards `gui` (the yargs subcommand) as an argument, which GApplication
  // reads as a file to open and refuses; only the program name goes in.
  const done = runApplication(app, [system.programInvocationName]);
  return done;
}
