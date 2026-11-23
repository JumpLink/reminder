/**
 * What the window remembers between runs: which sources the person switched off in the overview,
 * the colour scheme, the first day of the week and whether the month shows week numbers. None of it is the core's configuration.
 *
 * "Hidden" is a view filter and nothing else. It lives here, in the app's own file, and never
 * reaches the core: `disabled` (docs/adr/0006) is configuration the core enforces, while a hidden
 * source stays fully readable for the MCP server and the CLI.
 *
 * `@gjsify/app-settings` is not part of this repo's dependency set (and GSettings would need an
 * installed schema), so this is a small JSON file next to the config: `<config dir>/gui.json`.
 * A missing or damaged file means "nothing hidden" — a lost preference must not stop the window.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { IDENTITY } from '../../core/identity.ts';

export function settingsPath(env: Record<string, string | undefined> = process.env): string {
  const base = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config');
  return join(base, IDENTITY.configDirName, 'gui.json');
}

export function parseHidden(text: string): Set<string> {
  try {
    const raw: unknown = JSON.parse(text);
    const list = (raw as { hidden?: unknown } | null)?.hidden;
    if (!Array.isArray(list)) return new Set();
    return new Set(list.filter((v): v is string => typeof v === 'string'));
  } catch {
    return new Set();
  }
}

export const COLOR_SCHEMES = ['system', 'light', 'dark'] as const;
export type ColorScheme = (typeof COLOR_SCHEMES)[number];

/** `system` follows the locale. */
export const WEEK_STARTS = ['system', 'monday', 'sunday', 'saturday'] as const;
export type WeekStart = (typeof WEEK_STARTS)[number];

function oneOf<T extends string>(list: readonly T[], value: unknown, fallback: T): T {
  return typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function parseColorScheme(text: string): ColorScheme {
  return oneOf(COLOR_SCHEMES, readObject(text).colorScheme, 'system');
}

export function parseWeekStart(text: string): WeekStart {
  return oneOf(WEEK_STARTS, readObject(text).weekStart, 'system');
}

export function parseWeekNumbers(text: string): boolean {
  return readObject(text).weekNumbers === true;
}

function readObject(text: string): Record<string, unknown> {
  try {
    const raw: unknown = JSON.parse(text);
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export interface GuiSettings {
  hidden(): ReadonlySet<string>;
  /** Persist one source's state; returns the new set. */
  setHidden(target: string, hidden: boolean): ReadonlySet<string>;
  colorScheme(): ColorScheme;
  setColorScheme(value: ColorScheme): void;
  weekStart(): WeekStart;
  setWeekStart(value: WeekStart): void;
  /** ISO week numbers beside the month grid; off by default, as most locales do not use them. */
  weekNumbers(): boolean;
  setWeekNumbers(value: boolean): void;
}

/**
 * The settings over a file (when `path` is given) or over memory alone. Keys this build does not
 * know are written back, like the core's config does.
 */
function createSettings(path: string | null): GuiSettings {
  let text = '';
  if (path !== null) {
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      text = '';
    }
  }
  const hidden = parseHidden(text);
  let colorScheme = parseColorScheme(text);
  let weekStart = parseWeekStart(text);
  let weekNumbers = parseWeekNumbers(text);
  const unknown = readObject(text);

  const save = (): void => {
    if (path === null) return;
    try {
      mkdirSync(dirname(path), { recursive: true });
      const temp = `${path}.tmp`;
      const body = { ...unknown, hidden: [...hidden].sort(), colorScheme, weekStart, weekNumbers };
      writeFileSync(temp, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
      renameSync(temp, path);
    } catch {
      // The choice still holds for this run; failing to save it is not worth an error dialog.
    }
  };

  return {
    hidden: () => new Set(hidden),
    setHidden(target, value) {
      if (value) hidden.add(target);
      else hidden.delete(target);
      save();
      return new Set(hidden);
    },
    colorScheme: () => colorScheme,
    setColorScheme(value) {
      colorScheme = value;
      save();
    },
    weekStart: () => weekStart,
    setWeekStart(value) {
      weekStart = value;
      save();
    },
    weekNumbers: () => weekNumbers,
    setWeekNumbers(value) {
      weekNumbers = value;
      save();
    },
  };
}

export function createGuiSettings(path: string = settingsPath()): GuiSettings {
  return createSettings(path);
}

/** Demo mode: the choices hold for this run only and no file is read or written. */
export function createMemorySettings(): GuiSettings {
  return createSettings(null);
}
