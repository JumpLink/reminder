/**
 * Changing the configuration file. The model and its validation are `@reminder/core`'s; this file
 * owns the edits a preferences dialog makes and the atomic write.
 *
 * Every edit is a pure function from one `ReminderConfig` to the next. Keys this build does not
 * know ride along in `extra` and are written back (see `serializeConfig`), and a password never
 * enters a `ReminderConfig`: an account only names its `passwordSecret` (docs/adr/0011).
 *
 * Targets are spelled `<account>:<uid>` only while there is more than one account (docs/adr/0005),
 * so going from one account to two (and back) rewrites every target in the file; that is done
 * here, in one place, because a half-qualified file fails to load.
 */

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  _,
  ConfigError,
  DEFAULT_PASSWORD_ENV,
  fmt,
  isGranted,
  parseConfig,
  qualifyTarget,
  resolveAccountTarget,
  serializeConfig,
  columnKey,
  type AccountConfig,
  type ExternalSourceConfig,
  type Grant,
  type ItemKind,
  type MineFilter,
  type ReminderConfig,
  type TargetColumn,
} from '@reminder/core';

import { loadConfig } from './config.ts';

/** The config as the next load would read it. Throws a ConfigError when it would not load. */
export function normalizeConfig(config: ReminderConfig): ReminderConfig {
  return parseConfig(JSON.parse(serializeConfig(config)));
}

/**
 * Write the file atomically: a temporary file next to it, then a rename, so a crash leaves either
 * the old file or the new one. A config that would not load again is refused before anything is
 * written.
 */
export function writeConfig(path: string, config: ReminderConfig): void {
  normalizeConfig(config);
  const text = serializeConfig(config);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, text, 'utf8');
    renameSync(temp, path);
  } catch (err) {
    rmSync(temp, { force: true });
    throw err;
  }
}

/** Rewrite (or drop, with null) every calendar uid the file names. */
export function mapTargets(config: ReminderConfig, fn: (target: string) => string | null): ReminderConfig {
  const defaults: ReminderConfig['defaults'] = {};
  for (const [kind, target] of Object.entries(config.defaults)) {
    const mapped = target === undefined ? null : fn(target);
    if (mapped !== null) defaults[kind as ItemKind] = mapped;
  }
  const priorityList = config.priorities.list === undefined ? null : fn(config.priorities.list);
  return {
    ...config,
    grants: config.grants.flatMap((g) => {
      const target = fn(g.target);
      return target === null ? [] : [{ ...g, target }];
    }),
    routes: config.routes.flatMap((r) => {
      const target = fn(r.target);
      return target === null ? [] : [{ ...r, target }];
    }),
    defaults,
    priorities: priorityList === null ? {} : { ...config.priorities, list: priorityList },
    disabled: [
      ...new Set(
        config.disabled.flatMap((t) => {
          const target = fn(t);
          return target === null ? [] : [target];
        }),
      ),
    ],
  };
}

export function withDisabled(config: ReminderConfig, disabled: readonly string[]): ReminderConfig {
  return { ...config, disabled: [...disabled] };
}

export function withGrant(config: ReminderConfig, grant: Grant): ReminderConfig {
  if (isGranted(config.grants, grant.capability, grant.target)) return config;
  return { ...config, grants: [...config.grants, { capability: grant.capability, target: grant.target }] };
}

export function withoutGrant(config: ReminderConfig, grant: Grant): ReminderConfig {
  return {
    ...config,
    grants: config.grants.filter((g) => !(g.capability === grant.capability && g.target === grant.target)),
  };
}

/**
 * Add an account. From the one-account spelling the file moves to the `accounts` spelling and the
 * existing targets get their account prefix.
 */
export function withAccount(config: ReminderConfig, account: AccountConfig): ReminderConfig {
  if (config.accounts.some((a) => a.id === account.id))
    throw new ConfigError(fmt(_('account "{id}" already exists'), { id: account.id }));
  const { backend, caldav: _caldav, ...rest } = config;
  const accounts = [...config.accounts, account];
  let extra = rest.extra;
  // A caldav section left behind by a one-account `eds` file belongs to that account now.
  if (backend !== undefined && backend !== 'caldav' && extra.caldav !== undefined) {
    const { caldav: stashed, ...others } = extra;
    accounts[0] = { ...accounts[0], extra: { ...accounts[0].extra, caldav: stashed } };
    extra = others;
  }
  const next: ReminderConfig = { ...rest, extra, accounts };
  if (config.accounts.length !== 1) return next;
  const only = config.accounts[0].id;
  return mapTargets(next, (target) => qualifyTarget(only, target));
}

/**
 * Remove an account and everything in the file that names it. Back at one account the targets
 * lose their prefix again. The last account cannot go: a configuration is never empty.
 */
export function withoutAccount(config: ReminderConfig, id: string): ReminderConfig {
  if (!config.accounts.some((a) => a.id === id)) throw new ConfigError(fmt(_('no account "{id}"'), { id }));
  if (config.accounts.length === 1) throw new ConfigError(_('a configuration needs at least one account'));
  const accounts = config.accounts.filter((a) => a.id !== id);
  return mapTargets({ ...config, accounts }, (target) => {
    const split = resolveAccountTarget(config.accounts, target);
    if (split === null || split.account === id) return null;
    return accounts.length === 1 ? split.uid : target;
  });
}

const RESERVED = new Set(['http', 'https']);
const ID_MAX = 24;

/** A legal account id from what the person typed, unique among `taken`. */
export function accountIdFor(label: string, taken: readonly string[]): string {
  let base = label
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, ID_MAX)
    .replace(/-+$/, '');
  if (base === '' || RESERVED.has(base)) base = base === '' ? 'account' : `${base}-account`;
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

/** The account a manual CalDAV entry becomes. The password is NOT here: it goes to the secret store. */
export function caldavAccount(id: string, input: { url: string; username: string }): AccountConfig {
  return {
    id,
    backend: 'caldav',
    caldav: {
      url: input.url,
      auth: 'basic',
      username: input.username,
      passwordEnv: DEFAULT_PASSWORD_ENV,
      passwordSecret: `${id}:password`,
    },
    extra: {},
  };
}

export function edsAccount(id: string): AccountConfig {
  return { id, backend: 'eds', extra: {} };
}

/**
 * Where the preferences read and save the configuration. The file store re-reads on every `read`,
 * so an edit made elsewhere is honoured; the memory store is demo mode's: it never touches a file.
 */
export interface ConfigStore {
  /** False when a change lives only in this process (demo mode). */
  readonly persistent: boolean;
  read(): ReminderConfig;
  save(config: ReminderConfig): void;
}

export function createFileConfigStore(path: string): ConfigStore {
  return {
    persistent: true,
    read: () => loadConfig(path),
    save: (config) => writeConfig(path, config),
  };
}

export function createMemoryConfigStore(initial: ReminderConfig): ConfigStore {
  let current = normalizeConfig(initial);
  return {
    persistent: false,
    read: () => current,
    save(config) {
      current = normalizeConfig(config);
    },
  };
}

/** Demo mode never writes, whatever `path` says. */
export function createConfigStore(options: {
  demo: boolean;
  path: string;
  demoConfig: () => ReminderConfig;
}): ConfigStore {
  return options.demo ? createMemoryConfigStore(options.demoConfig()) : createFileConfigStore(options.path);
}

/** Whose cards every board shows unless a source says otherwise. */
export function withBoardsMine(config: ReminderConfig, mine: MineFilter): ReminderConfig {
  return { ...config, boards: { ...config.boards, mine } };
}

/** One source's own answer; `null` removes it so the section's default applies again. */
export function withSourceMine(
  config: ReminderConfig,
  source: string,
  mine: MineFilter | null,
): ReminderConfig {
  const { [source]: _dropped, ...others } = config.boards.sources;
  const sources =
    mine === null ? others : { ...others, [source]: { ...config.boards.sources[source], mine } };
  return { ...config, boards: { ...config.boards, sources } };
}

/**
 * Put one column in a lane, or (with `null`) back to the default. The file keeps only deviations:
 * a board with none left disappears. Entries that spell the same column differently (`To-Do` and
 * `todo`) are one key to the rules, so they are replaced together.
 */
export function withColumnLane(
  config: ReminderConfig,
  board: string,
  column: string,
  lane: TargetColumn | null,
): ReminderConfig {
  const key = columnKey(column);
  const kept = Object.entries(config.boards.columns[board] ?? {}).filter(([name]) => columnKey(name) !== key);
  const next = Object.fromEntries(lane === null ? kept : [...kept, [column, lane]]);
  const { [board]: _dropped, ...others } = config.boards.columns;
  const columns = Object.keys(next).length > 0 ? { ...others, [board]: next } : others;
  return { ...config, boards: { ...config.boards, columns } };
}

/** Add an external board source; its id shares the namespace of the account ids. */
export function withExternalSource(config: ReminderConfig, source: ExternalSourceConfig): ReminderConfig {
  const taken = [...config.accounts.map((a) => a.id), ...config.boardSources.map((s) => s.id)];
  if (taken.includes(source.id)) throw new ConfigError(fmt(_('"{id}" is already in use'), { id: source.id }));
  return { ...config, boardSources: [...config.boardSources, source] };
}

/** Change one external source in place; the order in the file stays. */
export function withEditedExternalSource(
  config: ReminderConfig,
  id: string,
  edit: (source: ExternalSourceConfig) => ExternalSourceConfig,
): ReminderConfig {
  if (!config.boardSources.some((s) => s.id === id))
    throw new ConfigError(fmt(_('no board source "{id}"'), { id }));
  return { ...config, boardSources: config.boardSources.map((s) => (s.id === id ? edit(s) : s)) };
}

export function withoutExternalSource(config: ReminderConfig, id: string): ReminderConfig {
  const boardSources = config.boardSources.filter((s) => s.id !== id);
  const { [id]: _dropped, ...sources } = config.boards.sources;
  const prefix = `${id}:`;
  const columns = Object.fromEntries(
    Object.entries(config.boards.columns).filter(([board]) => !board.startsWith(prefix)),
  );
  return { ...config, boardSources, boards: { ...config.boards, sources, columns } };
}
