import { describe, expect, it } from '@gjsify/unit';
import {
  createMemoryCacheStore,
  overridesFor,
  parseConfig,
  serializeConfig,
  type BoardRef,
  type SecretRef,
  type SecretStore,
  type SourceColumn,
} from '@reminder/core';

import { createMemoryConfigStore } from '../../../src/core/config-write.ts';
import { createMemorySettings } from '../../../src/frontends/gui/settings.ts';
import {
  addExternalSource,
  boardSourceRows,
  columnRows,
  editExternalSource,
  laneChoices,
  removeExternalSource,
  setColumnLane,
  setGlobalMine,
  setMineFor,
  setSourceDisabled,
  setSourceHidden,
  validateExternal,
} from '../../../src/frontends/gui/views/preferences/board-controller.ts';
import type { PreferencesEnv } from '../../../src/frontends/gui/views/preferences/controller.ts';

const BASE = {
  future: { keep: 1 },
  accounts: [{ id: 'home', backend: 'eds' }],
  boardSources: [
    { id: 'cloud', type: 'deck', url: 'https://cloud.example.org/', username: 'alice', note: 'x' },
  ],
};

const BOARD: BoardRef = { source: 'cloud', id: '10', title: 'Workshop', url: null } as BoardRef;
const col = (name: string, closed: boolean | null = null): SourceColumn => ({
  name,
  position: 0,
  closed,
  initial: null,
});

function setup() {
  const store = createMemoryConfigStore(parseConfig(BASE));
  const values = new Map<string, string>();
  const key = (r: SecretRef) => `${r.account}:${r.purpose}`;
  const secrets: SecretStore = {
    id: 'fake',
    lookup: async (r) =>
      values.has(key(r)) ? { status: 'found', value: values.get(key(r)) ?? '' } : { status: 'missing' },
    store: async (r, v) => {
      values.set(key(r), v);
      return { status: 'ok' };
    },
    clear: async (r) => {
      values.delete(key(r));
      return { status: 'ok' };
    },
  };
  const cache = createMemoryCacheStore();
  const settings = createMemorySettings();
  let rebuilds = 0;
  const env: PreferencesEnv = {
    store,
    settings,
    secrets: () => secrets,
    cache: () => cache,
    lists: () => [],
    failures: () => new Map(),
    boards: () => [],
    boardProblems: () => [],
    rebuild: async () => {
      rebuilds++;
    },
  };
  return { env, store, values, cache, settings, rebuilds: () => rebuilds };
}

export default async () => {
  await describe('board preferences', async () => {
    await it('round-trips: read, write, read is equal and unknown keys survive', async () => {
      const { env, store } = setup();
      const before = serializeConfig(store.read());
      store.save(store.read());
      expect(serializeConfig(store.read())).toBe(before);
      await setGlobalMine(env, 'watching');
      await setMineFor(env, 'cloud', 'all');
      await setColumnLane(env, 'deck', BOARD, col('Waiting'), 'backlog');
      await setSourceDisabled(env, 'cloud', true);
      const written = JSON.parse(serializeConfig(store.read()));
      expect(written.future.keep).toBe(1);
      expect(written.boardSources[0].note).toBe('x');
      expect(written.boards.mine).toBe('watching');
      expect(written.boards.sources.cloud.mine).toBe('all');
      expect(written.boards.columns['cloud:10'].Waiting).toBe('backlog');
      expect(written.boardSources[0].enabled).toBe(false);
      const again = serializeConfig(parseConfig(written));
      expect(again).toBe(serializeConfig(store.read()));
    });

    await it('stores only deviations from the default lane', async () => {
      const { env, store } = setup();
      const column = col('Doing');
      expect(columnRows(store.read(), 'deck', BOARD, [column])[0].custom).toBe(false);
      await setColumnLane(env, 'deck', BOARD, column, 'done');
      let row = columnRows(store.read(), 'deck', BOARD, [column])[0];
      expect(row.lane).toBe('done');
      expect(row.custom).toBe(true);
      expect(overridesFor(store.read().boards, BOARD).doing).toBe('done');
      await setColumnLane(env, 'deck', BOARD, column, 'in-progress');
      row = columnRows(store.read(), 'deck', BOARD, [column])[0];
      expect(row.custom).toBe(false);
      expect(Object.keys(store.read().boards.columns).length).toBe(0);
      await setColumnLane(env, 'deck', BOARD, col('Parked'), 'ignore');
      expect(columnRows(store.read(), 'deck', BOARD, [col('Parked')])[0].lane).toBe('ignore');
    });

    await it('offers the four lanes and ignore, and "not placed" only while it applies', async () => {
      expect(laneChoices('todo').join(',')).toBe('backlog,todo,in-progress,done,ignore');
      expect(laneChoices('unassigned')[0]).toBe('unassigned');
    });

    await it('mine: global, per source, and back to following the global answer', async () => {
      const { env, store } = setup();
      await setMineFor(env, 'cloud', 'watching');
      expect(boardSourceRows(store.read(), [], new Set(), [])[0].mine).toBe('watching');
      await setMineFor(env, 'cloud', null);
      expect(boardSourceRows(store.read(), [], new Set(), [])[0].mine).toBe(null);
      expect(Object.keys(store.read().boards.sources).length).toBe(0);
    });

    await it('hidden lives in the GUI settings, disabled in the config', async () => {
      const { env, store, settings, cache, rebuilds } = setup();
      await cache.put(
        { account: 'cloud', source: 'b' },
        { body: 'x', version: null, fetchedAt: '2026-11-19T00:00:00Z' },
      );
      await setSourceHidden(env, 'cloud', true);
      expect(settings.hidden().has('board:cloud')).toBe(true);
      expect(store.read().boardSources[0].enabled).toBe(true);
      const hiddenRow = boardSourceRows(store.read(), [], settings.hidden(), [])[0];
      expect(hiddenRow.hidden).toBe(true);
      await setSourceDisabled(env, 'cloud', true);
      expect(store.read().boardSources[0].enabled).toBe(false);
      expect(await cache.get({ account: 'cloud', source: 'b' })).toBe(null);
      expect(boardSourceRows(store.read(), [], settings.hidden(), [])[0].enabled).toBe(false);
      await setSourceDisabled(env, 'cloud', false);
      expect(store.read().boardSources[0].enabled).toBe(true);
      expect(rebuilds()).toBe(3);
    });

    await it('adds a source with the credential in the secret store only', async () => {
      const { env, store, values } = setup();
      const input = {
        name: 'Projects',
        type: 'openproject' as const,
        url: 'https://projects.example.org/',
        username: '',
        credential: 'tok-123',
      };
      const done = await addExternalSource(env, input);
      expect(done.ok).toBe(true);
      expect(values.get('projects:token')).toBe('tok-123');
      expect(JSON.stringify(store.read()).includes('tok-123')).toBe(false);
      expect(store.read().boardSources[1].secret).toBe('projects:token');
      expect(validateExternal({ ...input, url: 'http://projects.example.org/' }) !== null).toBe(true);
      expect(validateExternal({ ...input, credential: '' }) !== null).toBe(true);
      expect(validateExternal({ ...input, credential: '' }, true)).toBe(null);
      expect(validateExternal({ ...input, type: 'deck' }) !== null).toBe(true);
      expect((await addExternalSource(env, { ...input, credential: '' })).ok).toBe(false);
    });

    await it('edits address and credential, and removes with cache and secret', async () => {
      const { env, store, values, cache } = setup();
      const input = {
        name: '',
        type: 'deck' as const,
        url: 'https://cloud2.example.org/',
        username: 'bob',
        credential: 'new-pass',
      };
      expect((await editExternalSource(env, 'cloud', input)).ok).toBe(true);
      expect(store.read().boardSources[0].url).toBe('https://cloud2.example.org/');
      expect(store.read().boardSources[0].username).toBe('bob');
      expect(store.read().boardSources[0].extra.note).toBe('x');
      expect(values.get('cloud:password')).toBe('new-pass');
      await setMineFor(env, 'cloud', 'all');
      await cache.put(
        { account: 'cloud', source: 'b' },
        { body: 'x', version: null, fetchedAt: '2026-11-19T00:00:00Z' },
      );
      expect((await removeExternalSource(env, 'cloud')).ok).toBe(true);
      expect(store.read().boardSources.length).toBe(0);
      expect(Object.keys(store.read().boards.sources).length).toBe(0);
      expect(values.size).toBe(0);
      expect(await cache.get({ account: 'cloud', source: 'b' })).toBe(null);
    });
  });
};
