/**
 * What the board preferences show and every change they make, without Gtk so it runs under Node
 * tests. Same three steps as `controller.ts`: edit the config with a pure helper, save it through
 * the `ConfigStore`, rebuild.
 *
 * Two kinds of "off" (docs/adr/0006): *disabled* is configuration the core enforces (the source
 * is never constructed) and only exists for external sources, in `boardSources[].enabled`;
 * *hidden* is the quick overview switch and lives in the GUI settings, so the CLI and the MCP
 * server still see the source.
 */

import {
  _,
  BOARD_LANES,
  boardConfigKey,
  checkSourceUrl,
  classifyColumn,
  errorMessage,
  mineFor,
  overridesFor,
  parseSecretRef,
  secretPurposeOf,
  type BoardRef,
  type BoardSourceType,
  type ExternalSourceConfig,
  type ExternalSourceType,
  type MineFilter,
  type ReminderConfig,
  type SourceColumn,
  type TargetColumn,
} from '@reminder/core';

import {
  accountIdFor,
  withBoardsMine,
  withColumnLane,
  withEditedExternalSource,
  withExternalSource,
  withoutExternalSource,
  withSourceMine,
} from '../../../../core/config-write.ts';
import type { BoardBinding } from '../../board-sync.ts';
import type { BoardProblem } from '../../board-view-model.ts';
import { change, type Outcome, type PreferencesEnv } from './controller.ts';

/** The key under which the GUI settings remember that a board source is hidden. */
export const hiddenKey = (source: string): string => `board:${source}`;

export interface BoardSourceRow {
  id: string;
  type: BoardSourceType;
  /** The server address, or a word for sources that have none of their own. */
  detail: string;
  /** External sources only: the others are switched off on the accounts page. */
  external: boolean;
  enabled: boolean;
  hidden: boolean;
  /** The source's own "mine" answer; null = follows the global default. */
  mine: MineFilter | null;
  problem: string | null;
}

const typeName = (type: BoardSourceType): string =>
  type === 'deck' ? _('Nextcloud Deck') : type === 'openproject' ? _('OpenProject') : _('Zenkit');

export function boardSourceRows(
  config: ReminderConfig,
  bindings: readonly BoardBinding[],
  hidden: ReadonlySet<string>,
  problems: readonly BoardProblem[],
): BoardSourceRow[] {
  const types = new Map<string, BoardSourceType>();
  for (const binding of bindings) types.set(binding.entry.info.id, binding.entry.info.type);
  for (const source of config.boardSources) if (!types.has(source.id)) types.set(source.id, source.type);
  return [...types].map(([id, type]) => {
    const external = config.boardSources.find((s) => s.id === id);
    return {
      id,
      type,
      detail: external?.url ?? (type === 'vtodo' ? _('Task lists') : typeName(type)),
      external: external !== undefined,
      enabled: external?.enabled ?? true,
      hidden: hidden.has(hiddenKey(id)),
      mine: config.boards.sources[id]?.mine ?? null,
      problem: problems.find((p) => p.source === id)?.message ?? null,
    };
  });
}

export function boardsOf(bindings: readonly BoardBinding[], source: string): BoardRef[] {
  return bindings.filter((b) => b.entry.info.id === source).map((b) => b.board);
}

/** What a source with no answer of its own shows. */
export const defaultMine = (config: ReminderConfig): MineFilter => config.boards.mine;
export const effectiveMine = (config: ReminderConfig, source: string): MineFilter =>
  mineFor(config.boards, source);

export interface ColumnRow {
  name: string;
  lane: TargetColumn;
  defaultLane: TargetColumn;
  /** True when the person put it in another lane than the default. */
  custom: boolean;
}

export function columnRows(
  config: ReminderConfig,
  type: BoardSourceType,
  board: BoardRef,
  columns: readonly SourceColumn[],
): ColumnRow[] {
  const overrides = overridesFor(config.boards, board);
  return columns.map((column) => {
    const defaultLane = classifyColumn(type, column);
    const lane = classifyColumn(type, column, overrides);
    return { name: column.name, lane, defaultLane, custom: lane !== defaultLane };
  });
}

/** The four lanes and "ignore"; `unassigned` only while a column really is there. */
export function laneChoices(current: TargetColumn): TargetColumn[] {
  return current === 'unassigned' ? ['unassigned', ...BOARD_LANES, 'ignore'] : [...BOARD_LANES, 'ignore'];
}

export function laneLabel(lane: TargetColumn): string {
  switch (lane) {
    case 'backlog':
      return _('Backlog');
    case 'todo':
      return _('Todo');
    case 'in-progress':
      return _('In progress');
    case 'done':
      return _('Done');
    case 'ignore':
      return _('Ignore column');
    default:
      return _('Not placed');
  }
}

export function mineLabel(mine: MineFilter): string {
  return mine === 'assigned' ? _('Assigned to me') : mine === 'watching' ? _('Watching') : _('All cards');
}

export function setGlobalMine(env: PreferencesEnv, mine: MineFilter): Promise<Outcome> {
  return change(env, (config) => withBoardsMine(config, mine));
}

/** `null` = follow the global default again. */
export function setMineFor(env: PreferencesEnv, source: string, mine: MineFilter | null): Promise<Outcome> {
  return change(env, (config) => withSourceMine(config, source, mine));
}

/** A lane equal to the default stores nothing: the file keeps only what deviates. */
export function setColumnLane(
  env: PreferencesEnv,
  type: BoardSourceType,
  board: BoardRef,
  column: SourceColumn,
  lane: TargetColumn,
): Promise<Outcome> {
  const stored = lane === classifyColumn(type, column) ? null : lane;
  return change(env, (config) => withColumnLane(config, boardConfigKey(board), column.name, stored));
}

/** Hidden is a view filter: the GUI settings, then a rebuild so the board follows. */
export async function setSourceHidden(
  env: PreferencesEnv,
  source: string,
  hidden: boolean,
): Promise<Outcome> {
  try {
    env.settings.setHidden(hiddenKey(source), hidden);
    await env.rebuild();
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
  return { ok: true };
}

/** Off: never constructed and its local copy goes. On: the rebuild fetches it. */
export function setSourceDisabled(env: PreferencesEnv, source: string, disabled: boolean): Promise<Outcome> {
  return change(env, async (config) => {
    if (disabled) await env.cache().clear(source);
    return withEditedExternalSource(config, source, (s) => ({ ...s, enabled: !disabled }));
  });
}

export interface ExternalInput {
  name: string;
  type: ExternalSourceType;
  url: string;
  username: string;
  /** The app password, token or API key. Goes to the secret store, never to the file. */
  credential: string;
}

/** Null when the form can be submitted. `editing` lets the credential stay empty (= keep it). */
export function validateExternal(input: ExternalInput, editing = false): string | null {
  const url = input.url.trim();
  if (url === '' && input.type !== 'zenkit')
    return _('Enter the server address, e.g. https://cloud.example.org/');
  if (url !== '') {
    try {
      checkSourceUrl(url, 'url');
    } catch (err) {
      return errorMessage(err);
    }
  }
  if (input.type === 'deck' && input.username.trim() === '') return _('Enter the user name.');
  if (!editing && input.credential === '') {
    return input.type === 'deck' ? _('Enter the app password.') : _('Enter the access token.');
  }
  return null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export function externalSourceFrom(id: string, input: ExternalInput): ExternalSourceConfig {
  const url = input.url.trim();
  const username = input.username.trim();
  return {
    id,
    type: input.type,
    ...(url === '' ? {} : { url }),
    ...(input.type === 'deck' ? { username } : {}),
    secret: `${id}:${secretPurposeOf(input.type)}`,
    enabled: true,
    extra: {},
  };
}

/** The credential is stored first and removed again if the config refuses the source. */
export async function addExternalSource(env: PreferencesEnv, input: ExternalInput): Promise<Outcome> {
  const problem = validateExternal(input);
  if (problem !== null) return { ok: false, message: problem };
  let source: ExternalSourceConfig;
  try {
    const config = env.store.read();
    const id = accountIdFor(input.name.trim() || hostOf(input.url.trim()) || input.type, [
      ...config.accounts.map((a) => a.id),
      ...config.boardSources.map((s) => s.id),
    ]);
    source = externalSourceFrom(id, input);
    withExternalSource(config, source);
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
  const ref = parseSecretRef(source.secret);
  const secrets = env.secrets();
  const stored = await secrets.store(ref, input.credential);
  if (stored.status !== 'ok') return { ok: false, message: stored.reason };
  const done = await change(env, (config) => withExternalSource(config, source));
  if (!done.ok) {
    await secrets.clear(ref);
    return done;
  }
  return { ok: true, id: source.id };
}

/** Address and user name change in the file; a non-empty credential replaces the stored one. */
export async function editExternalSource(
  env: PreferencesEnv,
  id: string,
  input: ExternalInput,
): Promise<Outcome> {
  const problem = validateExternal(input, true);
  if (problem !== null) return { ok: false, message: problem };
  const current = env.store.read().boardSources.find((s) => s.id === id);
  if (!current) return { ok: false, message: _('This source no longer exists.') };
  if (input.credential !== '') {
    const stored = await env.secrets().store(parseSecretRef(current.secret), input.credential);
    if (stored.status !== 'ok') return { ok: false, message: stored.reason };
  }
  return change(env, (config) =>
    withEditedExternalSource(config, id, (s) => {
      const next = externalSourceFrom(id, { ...input, type: s.type });
      return { ...s, url: next.url, username: next.username };
    }),
  );
}

/** Drops the source and what names it, then its cache and its stored credential. */
export async function removeExternalSource(env: PreferencesEnv, id: string): Promise<Outcome> {
  const reference = env.store.read().boardSources.find((s) => s.id === id)?.secret;
  const done = await change(env, (config) => withoutExternalSource(config, id));
  if (!done.ok) return done;
  try {
    await env.cache().clear(id);
    if (reference !== undefined) await env.secrets().clear(parseSecretRef(reference));
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
  return { ok: true };
}
