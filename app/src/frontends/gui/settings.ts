/**
 * What the window remembers between runs: which sources the person switched off in the overview.
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

export interface GuiSettings {
  hidden(): ReadonlySet<string>;
  /** Persist one source's state; returns the new set. */
  setHidden(target: string, hidden: boolean): ReadonlySet<string>;
}

export function createGuiSettings(path: string = settingsPath()): GuiSettings {
  let hidden: Set<string>;
  try {
    hidden = parseHidden(readFileSync(path, 'utf8'));
  } catch {
    hidden = new Set();
  }
  return {
    hidden: () => new Set(hidden),
    setHidden(target, value) {
      if (value) hidden.add(target);
      else hidden.delete(target);
      try {
        mkdirSync(dirname(path), { recursive: true });
        const temp = `${path}.tmp`;
        writeFileSync(temp, `${JSON.stringify({ hidden: [...hidden].sort() }, null, 2)}\n`, 'utf8');
        renameSync(temp, path);
      } catch {
        // The choice still holds for this run; failing to save it is not worth an error dialog.
      }
      return new Set(hidden);
    },
  };
}

/** Demo mode: the choices hold for this run only and no file is read or written. */
export function createMemorySettings(): GuiSettings {
  const hidden = new Set<string>();
  return {
    hidden: () => new Set(hidden),
    setHidden(target, value) {
      if (value) hidden.add(target);
      else hidden.delete(target);
      return new Set(hidden);
    },
  };
}
