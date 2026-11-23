/**
 * What the preferences dialog shows and every change it makes, without Gtk so it runs under Node
 * tests. The widgets (one file per page) only paint these rows and call these functions.
 *
 * Every change is the same three steps: edit the config with a pure helper, save it through the
 * `ConfigStore` (a file, or memory in demo mode), then `rebuild` the window's sync and backends so
 * the views follow. Rebuilding is how a re-enabled source is fetched at once: the new sync service
 * starts with every enabled source. A password goes to the secret store and nowhere else.
 */

import {
  _,
  CAPABILITIES,
  errorMessage,
  fmt,
  isGranted,
  parseSecretRef,
  boardTarget,
  isBoardCapability,
  setSourceEnabled,
  targetOfCacheKey,
  type AccountConfig,
  type CacheStore,
  type Capability,
  type ItemKind,
  type ReminderConfig,
  type SecretStore,
} from '@reminder/core';

import { createVdirBackend } from '@reminder/vdir';

import {
  accountIdFor,
  caldavAccount,
  edsAccount,
  vdirAccount,
  withAccount,
  withDisabled,
  withGrant,
  withoutAccount,
  withoutGrant,
  type ConfigStore,
} from '../../../../core/config-write.ts';
import type { GuiSettings } from '../../settings.ts';
import type { BoardBinding } from '../../board-sync.ts';
import type { BoardProblem } from '../../board-view-model.ts';
import type { AccountLists } from '../../sync-sources.ts';

/** What the dialog needs from the running window; `main.ts` supplies the real thing. */
export interface PreferencesEnv {
  store: ConfigStore;
  settings: GuiSettings;
  secrets(): SecretStore;
  cache(): CacheStore;
  /** Every collection of every account that could be listed, disabled ones included. */
  lists(): readonly AccountLists[];
  /** Account id → why it could not be set up. */
  failures(): ReadonlyMap<string, string>;
  /** Every board of every source that could be listed. */
  boards(): readonly BoardBinding[];
  /** Sources that could not even list their boards. */
  boardProblems(): readonly BoardProblem[];
  /** Rebuild sync and backends from the saved config; resolves when the new service is running. */
  rebuild(): Promise<void>;
}

export type Outcome = { ok: true; id?: string } | { ok: false; message: string };

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface AccountRow {
  id: string;
  backend: AccountConfig['backend'];
  /** The server URL, or a word for the system's accounts. */
  detail: string;
  /** Null while the account works. */
  problem: string | null;
}

export function accountRows(config: ReminderConfig, failures: ReadonlyMap<string, string>): AccountRow[] {
  return config.accounts.map((a) => ({
    id: a.id,
    backend: a.backend,
    detail: a.caldav?.url ?? (a.backend === 'vdir' ? _('Local lists') : _('System calendars')),
    problem: failures.get(a.id) ?? null,
  }));
}

export interface CollectionRow {
  /** The config's spelling: what `disabled` and a grant name. */
  target: string;
  name: string;
  kind: ItemKind;
  enabled: boolean;
}

function targetOf(config: ReminderConfig, account: string, uid: string): string {
  return targetOfCacheKey(config.accounts, { account, source: uid });
}

export function collectionRows(
  config: ReminderConfig,
  lists: readonly AccountLists[],
  account: string,
): CollectionRow[] {
  const own = lists.find((l) => l.account === account);
  if (!own) return [];
  return own.calendars
    .map((c) => {
      const target = targetOf(config, account, c.uid);
      return {
        target,
        name: c.name || _('Untitled'),
        kind: c.kind,
        enabled: !config.disabled.includes(target),
      };
    })
    .sort((a, b) => byText(a.kind, b.kind) || byText(a.name, b.name) || byText(a.target, b.target));
}

export const capabilityLabel = (capability: Capability): string => {
  switch (capability) {
    case 'calendar.create':
      return _('Create events');
    case 'reminder.create':
      return _('Create reminders');
    case 'reminder.update':
      return _('Change reminders');
    case 'board.move':
      return _('Move board cards');
    case 'board.update':
      return _('Edit board cards');
    case 'board.create':
      return _('Add board cards');
  }
};

export interface TargetChoice {
  target: string;
  label: string;
}

/**
 * Where a capability can apply: events for event creation, task lists for reminders, and for the
 * board capabilities every board of a source that can write at all (ADR 0013 §1–2).
 */
export function targetChoices(
  config: ReminderConfig,
  lists: readonly AccountLists[],
  capability: Capability,
  boards: readonly BoardBinding[] = [],
): TargetChoice[] {
  if (isBoardCapability(capability)) return boardChoices(boards.filter((b) => b.entry.info.canWrite));
  const kind: ItemKind = capability === 'calendar.create' ? 'event' : 'reminder';
  const named = config.accounts.length > 1;
  return lists
    .flatMap(({ account, calendars }) =>
      calendars
        .filter((c) => c.kind === kind)
        .map((c) => ({
          target: targetOf(config, account, c.uid),
          label: named ? `${c.name || _('Untitled')} (${account})` : c.name || _('Untitled'),
        })),
    )
    .sort((a, b) => byText(a.label, b.label) || byText(a.target, b.target));
}

function boardChoices(boards: readonly BoardBinding[]): TargetChoice[] {
  const named = new Set(boards.map((b) => b.board.source)).size > 1;
  return boards
    .map(({ board }) => {
      const title = board.title || _('Untitled');
      return {
        target: boardTarget(board.source, board.id),
        label: named ? `${title} (${board.source})` : title,
      };
    })
    .sort((a, b) => byText(a.label, b.label) || byText(a.target, b.target));
}

export interface GrantRow {
  capability: Capability;
  target: string;
  /** The collection's or board's name when it is known, else the target as written. */
  name: string;
}

export function grantRows(
  config: ReminderConfig,
  lists: readonly AccountLists[],
  boards: readonly BoardBinding[] = [],
): GrantRow[] {
  const names = new Map<string, string>();
  for (const capability of CAPABILITIES)
    for (const choice of targetChoices(config, lists, capability)) names.set(choice.target, choice.label);
  // Every board, writable or not: a grant left over from a source that lost write access is
  // still easier to revoke under its title than under its id.
  for (const choice of boardChoices(boards)) names.set(choice.target, choice.label);
  return config.grants
    .map((g) => ({ capability: g.capability, target: g.target, name: names.get(g.target) ?? g.target }))
    .sort((a, b) => byText(a.name, b.name) || byText(a.capability, b.capability));
}

/** Run a change: failures become a message for the dialog, never an exception. */
export async function change(
  env: PreferencesEnv,
  edit: (config: ReminderConfig) => Promise<ReminderConfig> | ReminderConfig,
): Promise<Outcome> {
  try {
    env.store.save(await edit(env.store.read()));
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
  try {
    await env.rebuild();
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
  return { ok: true };
}

/** Off: the source is no longer fetched and its local copy goes. On: the rebuild fetches it. */
export function setCollectionEnabled(
  env: PreferencesEnv,
  target: string,
  enabled: boolean,
): Promise<Outcome> {
  return change(env, async (config) =>
    withDisabled(
      config,
      await setSourceEnabled(config.accounts, config.disabled, target, enabled, env.cache()),
    ),
  );
}

export function addGrant(env: PreferencesEnv, capability: Capability, target: string): Promise<Outcome> {
  return change(env, (config) => {
    if (isGranted(config.grants, capability, target)) return config;
    return withGrant(config, { capability, target });
  });
}

export function removeGrant(env: PreferencesEnv, capability: Capability, target: string): Promise<Outcome> {
  return change(env, (config) => withoutGrant(config, { capability, target }));
}

export interface CaldavInput {
  name: string;
  url: string;
  username: string;
  password: string;
}

/** Null when the form can be submitted. */
export function validateCaldav(input: CaldavInput): string | null {
  try {
    const url = new URL(input.url.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
      return _('The address must start with https://');
  } catch {
    return _('Enter the server address, e.g. https://dav.example.org/');
  }
  if (input.username.trim() === '') return _('Enter the user name.');
  if (input.password === '') return _('Enter the password.');
  return null;
}

/**
 * The password is stored first: an account whose password could not be kept would sign in to
 * nothing. If the config then refuses the account, the stored password is removed again.
 */
export async function addCaldavAccount(env: PreferencesEnv, input: CaldavInput): Promise<Outcome> {
  const problem = validateCaldav(input);
  if (problem !== null) return { ok: false, message: problem };
  let id = '';
  let account: AccountConfig;
  try {
    const config = env.store.read();
    const username = input.username.trim();
    id = accountIdFor(
      input.name.trim() || username,
      config.accounts.map((a) => a.id),
    );
    account = caldavAccount(id, { url: input.url.trim(), username });
    withAccount(config, account);
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
  const ref = parseSecretRef(`${id}:password`);
  const secrets = env.secrets();
  const stored = await secrets.store(ref, input.password);
  if (stored.status !== 'ok') return { ok: false, message: stored.reason };
  const done = await change(env, (config) => withAccount(config, account));
  if (!done.ok) {
    await secrets.clear(ref);
    return done;
  }
  return { ok: true, id };
}

/** Whether the system's accounts (Evolution Data Server) are not configured yet. */
export function canAddSystemAccounts(config: ReminderConfig): boolean {
  return !config.accounts.some((a) => a.backend === 'eds');
}

export function addSystemAccounts(env: PreferencesEnv): Promise<Outcome> {
  return change(env, (config) => {
    const id = accountIdFor(
      'system',
      config.accounts.map((a) => a.id),
    );
    return withAccount(config, edsAccount(id));
  });
}

export function canRemoveAccount(config: ReminderConfig): boolean {
  return config.accounts.length > 1;
}

/** Drops the account from the file, then its cache and its stored password. */
export async function removeAccount(env: PreferencesEnv, id: string): Promise<Outcome> {
  const before = env.store.read();
  const reference = before.accounts.find((a) => a.id === id)?.caldav?.passwordSecret;
  const done = await change(env, (config) => withoutAccount(config, id));
  if (!done.ok) return done;
  try {
    await env.cache().clear(id);
    if (reference !== undefined) await env.secrets().clear(parseSecretRef(reference));
  } catch (err) {
    return {
      ok: false,
      message: fmt(_('The account is removed, but cleaning up failed: {message}'), {
        message: errorMessage(err),
      }),
    };
  }
  return { ok: true };
}

export interface LocalListInput {
  name: string;
  /** `#rrggbb`, or empty for none. */
  color: string;
  /** The vdir root; the account's own `path` wins when one exists. */
  root: string;
}

/** Whether a name can become a local list. */
export function validateLocalList(input: LocalListInput): string | null {
  if (input.name.trim() === '') return _('Enter a name for the list.');
  if (input.color !== '' && !/^#[0-9a-fA-F]{6}$/.test(input.color))
    return _('The colour must look like #3584e4.');
  return null;
}

/**
 * Create a local task list in the vdir directory, and the `vdir` account that serves it when the
 * configuration has none yet. The directory is the person's data: the list is a folder of `.ics`.
 */
export async function createLocalList(env: PreferencesEnv, input: LocalListInput): Promise<Outcome> {
  const problem = validateLocalList(input);
  if (problem !== null) return { ok: false, message: problem };
  try {
    const config = env.store.read();
    const existing = config.accounts.find((a) => a.backend === 'vdir');
    const root = existing?.vdir?.path ?? input.root;
    const created = await createVdirBackend({ root }).createCollection({
      name: input.name,
      kind: 'reminder',
      ...(input.color !== '' ? { color: input.color } : {}),
    });
    if (existing === undefined) {
      const id = accountIdFor(
        'local',
        config.accounts.map((a) => a.id),
      );
      const done = await change(env, (c) => withAccount(c, vdirAccount(id)));
      if (!done.ok) return done;
      return { ok: true, id };
    }
    await env.rebuild();
    return { ok: true, id: existing.id + ':' + created };
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
}
