import { describe, expect, it } from '@gjsify/unit';
import { parseConfig, type BoardSource } from '@reminder/core';

import { createBoardSources, disabledIn } from '../../../src/core/board-sources.ts';
import { calendar, createFakeBackend, vtodo } from '../fake-backend.ts';

const TWO = {
  accounts: [
    { id: 'home', backend: 'eds' },
    { id: 'work', backend: 'eds' },
  ],
};

function backendOf(prefix: string) {
  return createFakeBackend(
    [calendar('tasks', 'reminder', 'Tasks'), calendar('private', 'reminder', 'Private')],
    {
      tasks: [vtodo(`${prefix}-1`, ['SUMMARY:Shown', 'STATUS:NEEDS-ACTION'])],
      private: [vtodo(`${prefix}-2`, ['SUMMARY:Hidden', 'STATUS:NEEDS-ACTION'])],
    },
  );
}

async function boardIds(source: BoardSource | undefined): Promise<string[]> {
  if (!source) return [];
  return (await source.listBoards()).map((board) => board.id);
}

async function cardTitles(source: BoardSource | undefined): Promise<string[]> {
  if (!source) return [];
  const titles: string[] = [];
  for (const board of await source.listBoards()) {
    const page = await source.listCards(board, { mine: 'all', includeClosed: true });
    if (page.kind === 'changed') for (const card of page.cards) titles.push(card.title);
  }
  return titles.sort();
}

export default async () => {
  await describe('board source registry', async () => {
    await it('builds one source per account, in file order', async () => {
      const config = parseConfig(TWO);
      const set = createBoardSources({ config, backend: (a) => backendOf(a.id) });
      expect(set.problems.length).toBe(0);
      expect(set.sources.map((s) => s.info.id).join(',')).toBe('home,work');
      expect(set.sources.every((s) => s.info.type === 'vtodo')).toBe(true);
      expect(set.sources.every((s) => s.info.canWrite === false)).toBe(true);
    });

    await it('builds writing sources only when asked to', async () => {
      const config = parseConfig(TWO);
      const set = createBoardSources({ config, backend: (a) => backendOf(a.id), writable: true });
      // The adapter can write (ADR 0013 §2); the grant is still asked for in `write.ts`.
      expect(set.sources.every((s) => s.info.canWrite === true)).toBe(true);
      expect(set.sources.every((s) => s.source.writeCard !== undefined)).toBe(true);
    });

    await it('never loads a disabled list, named as its account spells it', async () => {
      const config = parseConfig({ ...TWO, disabled: ['work:private'] });
      const set = createBoardSources({ config, backend: (a) => backendOf(a.id) });
      const work = set.sources.find((s) => s.info.id === 'work')?.source;
      const home = set.sources.find((s) => s.info.id === 'home')?.source;
      expect(await boardIds(work)).toEqualArray(['tasks']);
      expect(await cardTitles(work)).toEqualArray(['Shown']);
      // The same uid on another account stays on: `disabled` names a target, not a bare uid.
      expect((await boardIds(home)).length).toBe(2);
    });

    await it('resolves a bare uid against the single-account spelling', async () => {
      const single = parseConfig({ accounts: [{ id: 'home', backend: 'eds' }], disabled: ['private'] });
      expect(disabledIn(single, 'home')).toEqualArray(['private']);
      expect(disabledIn(parseConfig(TWO), 'home')).toEqualArray([]);
      expect(disabledIn(parseConfig({ ...TWO, disabled: ['home:private'] }), 'work')).toEqualArray([]);
    });

    await it('skips an account whose backend could not be built', async () => {
      const config = parseConfig(TWO);
      const set = createBoardSources({
        config,
        backend: (a) => (a.id === 'work' ? null : backendOf(a.id)),
      });
      expect(set.sources.map((s) => s.info.id).join(',')).toBe('home');
      expect(set.problems.length).toBe(0);
    });

    await it('reports a type this build has no factory for, and keeps the rest', async () => {
      const config = parseConfig(TWO);
      const set = createBoardSources({ config, backend: (a) => backendOf(a.id) }, { factories: {} });
      expect(set.sources.length).toBe(0);
      expect(set.problems.length).toBe(2);
      expect(set.problems[0].includes('vtodo')).toBe(true);
    });

    await it('carries the schedule kind and the host of every source', async () => {
      const config = parseConfig(TWO);
      const set = createBoardSources(
        { config, backend: (a) => backendOf(a.id) },
        { host: (a) => `${a.id}.example.org` },
      );
      expect(set.sources.map((s) => s.kind).join(',')).toBe('eds,eds');
      expect(set.sources.map((s) => s.host).join(',')).toBe('home.example.org,work.example.org');
      expect(createBoardSources({ config, backend: (a) => backendOf(a.id) }).sources[0].host).toBe('local');
    });

    await it('answers "me" from the configured addresses', async () => {
      const config = parseConfig({ accounts: [{ id: 'home', backend: 'eds' }] });
      const set = createBoardSources({
        config,
        backend: () => backendOf('home'),
        identity: { id: 'her@example.org', displayName: 'Someone', addresses: ['her@example.org'] },
      });
      const me = await set.sources[0].source.whoAmI();
      expect(me.id).toBe('her@example.org');
      expect(me.displayName).toBe('Someone');
      expect(me.isMe).toBe(true);
    });
  });
};
