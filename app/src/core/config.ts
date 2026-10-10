/**
 * Where the configuration file lives and how it is read. The model and its validation are
 * `@reminder/core`'s; this file only owns the path and the I/O.
 *
 * A missing file is an empty config — reading works without one, writing is denied by the empty
 * grant list. An unreadable or invalid file is an error, never a silent fallback to empty: that
 * would turn a typo into "every grant revoked" without a word.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { ConfigError, emptyConfig, errorMessage, parseConfig, type ReminderConfig } from '@reminder/core';

export function configPath(env: Record<string, string | undefined> = process.env): string {
  if (env.REMINDER_CONFIG) return env.REMINDER_CONFIG;
  const base = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config');
  return join(base, 'reminder', 'config.json');
}

export function loadConfig(path: string = configPath()): ReminderConfig {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as { code?: unknown }).code === 'ENOENT') return emptyConfig();
    throw new ConfigError(`cannot read ${path}: ${errorMessage(err)}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(`${path} is not valid JSON: ${errorMessage(err)}`);
  }
  try {
    return parseConfig(raw);
  } catch (err) {
    throw new ConfigError(`${path}: ${errorMessage(err)}`);
  }
}
