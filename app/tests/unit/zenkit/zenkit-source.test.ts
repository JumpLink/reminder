import { describe, expect, it } from '@gjsify/unit';
import { RateLimitedError } from '@gjsify/http-client';
import {
  boardSourceContract,
  boardSourceWriteContract,
  classifyCard,
  ConflictError,
  InputError,
  type Card,
} from '@reminder/core';
import { createZenkitBoardSource, type ZenkitOptions } from '@reminder/zenkit';

import { startFakeZenkit, type FakeZenkit } from './fake-zenkit-server.ts';
import { API_KEY, garden, ME, workshop } from './fixtures.ts';

const clone = <T>(value: T): T => structuredClone(value);

async function withZenkit(
  run: (
    fake: FakeZenkit,
    make: (extra?: Partial<ZenkitOptions>) => ReturnType<typeof createZenkitBoardSource>,
  ) => Promise<void>,
  rateLimitSeconds?: number,
): Promise<void> {
  const fake = await startFakeZenkit([clone(workshop), clone(garden)], {
    apiKey: API_KEY,
    me: ME,
    rateLimitSeconds,
  });
  const make = (extra: Partial<ZenkitOptions> = {}) =>
    createZenkitBoardSource({ id: 'zk', apiKey: API_KEY, baseUrl: fake.url, ...extra });
  try {
    await run(fake, make);
  } finally {
    await fake.close();
  }
}

const rejection = async (promise: Promise<unknown>): Promise<Error> => {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected a rejection');
};

const cardsOf = async (
  page: ReturnType<ReturnType<typeof createZenkitBoardSource>['listCards']>,
): Promise<Card[]> => {
  const answer = await page;
  if (answer.kind !== 'changed') throw new Error('unchanged');
  return answer.cards;
};

export default async () => {
  await describe('Zenkit board writes', async () => {
    for (const name of boardSourceWriteContract(() => {
      throw new Error('replaced below');
    }).map((c) => c.name)) {
      await it(`write contract: ${name}`, async () => {
        await withZenkit(async (_fake, make) => {
          const found = boardSourceWriteContract(() => make()).find((c) => c.name === name);
          await found!.run();
        });
      });
    }

    await it('says it can write', async () => {
      await withZenkit(async (_fake, make) => {
        const source = make();
        expect(source.describe().canWrite).toBe(true);
        expect(source.writeCard !== undefined).toBe(true);
      });
    });

    await it('refuses when the entry changed after the caller read it, and writes nothing', async () => {
      await withZenkit(async (fake, make) => {
        const source = make();
        const [board] = await source.listBoards();
        const seen = (await cardsOf(source.listCards(board, { mine: 'all' }))).find((c) => c.ref.id === 'E1');
        if (!seen) throw new Error('fixture card missing');
        fake.touch('wk1', 'E1', { displayString: 'Edited by Robin' });
        fake.rest.requests.filter((r) => r.method !== 'GET' && r.method !== 'POST').length;
        const before = fake.rest.requests.filter((r) => r.method === 'PUT').length;
        const err = await rejection(
          source.writeCard!({ kind: 'move', ref: seen.ref, version: seen.version, toColumn: 'Done' }),
        );
        expect(err instanceof ConflictError).toBe(true);
        expect(fake.rest.requests.filter((r) => r.method === 'PUT').length).toBe(before);
        const stored = fake.entriesOf('wk1').find((e) => e.shortId === 'E1');
        expect(JSON.stringify(stored?.['a-status_categories'])).toBe('[101]');
      });
    });
  });

  await describe('Zenkit board source', async () => {
    for (const check of boardSourceContract(() => {
      throw new Error('replaced below');
    }).map((c) => c.name)) {
      await it(`contract: ${check}`, async () => {
        await withZenkit(async (_fake, make) => {
          const found = boardSourceContract(() => make()).find((c) => c.name === check);
          await found!.run();
        });
      });
    }

    await it('maps lists to boards and choice values to ordered columns', async () => {
      await withZenkit(async (_fake, make) => {
        const source = make();
        expect(source.describe().type).toBe('zenkit');
        expect(source.describe().hasWatchers).toBe(false);
        const boards = await source.listBoards();
        expect(boards.map((b) => b.title).join()).toBe('Workshop,Garden');
        const columns = await source.listColumns(boards[0]);
        expect(columns.map((c) => c.name).join()).toBe('Backlog,To do,Doing,Done,No value');
        expect(columns[0].position).toBe(0);
        expect(columns[0].closed).toBe(null);
        expect((await source.whoAmI()).id).toBe(ME.id);
      });
    });

    await it('reads cards: assignees, labels, due, url, watchers unknown', async () => {
      await withZenkit(async (_fake, make) => {
        const source = make();
        const [board] = await source.listBoards();
        const all = await cardsOf(source.listCards(board, { mine: 'all' }));
        expect(all.length).toBe(5);
        const e2 = all.find((c) => c.ref.id === 'E2')!;
        expect(e2.sourceColumn).toBe('Doing');
        expect(e2.labels.map((l) => l.name).join()).toBe('electrics');
        expect(e2.due).toBe('2026-12-04T17:00:00Z');
        expect(e2.assignees[0].isMe).toBe(false);
        expect(e2.watchedByMe).toBe(null);
        const e1 = all.find((c) => c.ref.id === 'E1')!;
        expect(e1.due).toBe('2026-12-01');
        expect(e1.url).toBe('https://base.zenkit.com/l/wk1/E1');
        expect(all.find((c) => c.ref.id === 'E4')!.sourceColumn).toBe('No value');
        const mine = await cardsOf(source.listCards(board));
        expect(
          mine
            .map((c) => c.ref.id)
            .sort()
            .join(),
        ).toBe('E1,E3,E5');
        const capped = await source.listCards(board, { mine: 'all', limit: 2 });
        expect(capped.kind === 'changed' && capped.cards.length === 2 && capped.omitted === 3).toBe(true);
      });
    });

    await it('selects the column and person field per list; default is the first', async () => {
      await withZenkit(async (_fake, make) => {
        const plain = make();
        const boards = await plain.listBoards();
        const gardenBoard = boards[1];
        expect((await plain.listColumns(gardenBoard)).map((c) => c.name).join()).toBe('Low,High,No value');

        const tuned = make({ lists: { gd2: { columnField: 'Stage', personField: 'b-own' } } });
        expect((await tuned.listColumns(gardenBoard)).map((c) => c.name).join()).toBe(
          'Sow,Grow,Harvested,No value',
        );
        const mine = await cardsOf(tuned.listCards(gardenBoard));
        expect(
          mine
            .map((c) => c.ref.id)
            .sort()
            .join(),
        ).toBe('G1,G3');
        expect(mine.find((c) => c.ref.id === 'G1')!.sourceColumn).toBe('Sow');
        // The default person field is "Reviewer": that is G2.
        const byDefault = await cardsOf(plain.listCards(gardenBoard));
        expect(byDefault.map((c) => c.ref.id).join()).toBe('G2');

        const wrong = make({ lists: { gd2: { columnField: 'Planted' } } });
        expect((await rejection(wrong.listColumns(gardenBoard))) instanceof InputError).toBe(true);
        const missing = make({ lists: { gd2: { personField: 'Nobody' } } });
        expect((await rejection(missing.listCards(gardenBoard))) instanceof InputError).toBe(true);
      });
    });

    await it('feeds choice values into the lane rules', async () => {
      await withZenkit(async (_fake, make) => {
        const source = make();
        const [board] = await source.listBoards();
        const columns = await source.listColumns(board);
        const cards = await cardsOf(source.listCards(board, { mine: 'all' }));
        const lane = (id: string) =>
          classifyCard(
            'zenkit',
            cards.find((c) => c.ref.id === id)!,
            columns,
          );
        expect(lane('E1')).toBe('todo');
        expect(lane('E2')).toBe('in-progress');
        expect(lane('E3')).toBe('done');
        expect(lane('E4')).toBe('unassigned');
      });
    });

    await it('detects changes with one probe and re-reads after an edit', async () => {
      await withZenkit(async (fake, make) => {
        const source = make();
        const [board] = await source.listBoards();
        const first = await source.listCards(board, { mine: 'all' });
        if (first.kind !== 'changed') throw new Error('first read must change');
        const before = fake.rest.requests.length;
        const same = await source.listCards(board, { mine: 'all' }, first.token);
        expect(same.kind).toBe('unchanged');
        const probes = fake.rest.requests.slice(before).filter((r) => r.path.endsWith('/entries/filter'));
        expect(probes.length).toBe(1);
        expect(JSON.parse(probes[0].body).limit).toBe(1);

        fake.touch('wk1', 'E1', { displayString: 'Sharpen both plane irons' });
        const next = await source.listCards(board, { mine: 'all' }, first.token);
        expect(next.kind).toBe('changed');
        // A different query is a different token.
        const other = await source.listCards(board, { mine: 'assigned' }, first.token);
        expect(other.kind).toBe('changed');
      });
    });

    await it('answers an unknown list with boardNotFound', async () => {
      await withZenkit(async (_fake, make) => {
        const err = await rejection(make().listColumns({ source: 'zk', id: 'nope', title: 'x', url: null }));
        expect(err instanceof InputError && err.message.includes('nope')).toBe(true);
      });
    });

    await it('limits boards to onlyLists', async () => {
      await withZenkit(async (_fake, make) => {
        const boards = await make({ onlyLists: ['list-uuid-garden'] }).listBoards();
        expect(boards.map((b) => b.id).join()).toBe('gd2');
      });
    });

    await it('surfaces a 429 with retryAfterMs and never leaks the key', async () => {
      await withZenkit(async (_fake, make) => {
        const err = await rejection(make().listBoards());
        expect(err instanceof RateLimitedError).toBe(true);
        expect((err as RateLimitedError).retryAfterMs).toBe(7000);
        expect(err.message.includes(API_KEY)).toBe(false);
      }, 7);
    });

    await it('turns a wrong key into an error that does not contain it', async () => {
      await withZenkit(async (_fake, make) => {
        const wrong = 'zk-wrong-key-9999';
        const err = await rejection(make({ apiKey: wrong }).whoAmI());
        expect(err.message.includes(wrong)).toBe(false);
        expect(JSON.stringify(err).includes(wrong)).toBe(false);
      });
    });
  });
};
