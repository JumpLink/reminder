import { describe, expect, it } from '@gjsify/unit';
import type { Card, SourceColumn } from '@reminder/core';

import {
  BOARD_CACHE_PREFIX,
  boardCacheKey,
  boardSourceOfCacheKey,
  decodeBoardBody,
  encodeBoardBody,
  isBoardCacheKey,
} from '../../../src/core/board-cache.ts';

const COLUMNS: SourceColumn[] = [
  { name: 'To do', position: 0, closed: false, initial: true },
  { name: 'Done', position: 1, closed: true, initial: false },
];

const CARD: Card = {
  ref: { source: 'studio', board: 'relaunch', id: 'c1' },
  title: 'Draft the launch note',
  sourceColumn: 'To do',
  closed: false,
  due: '2026-12-01',
  assignees: [{ id: 'alex@example.org', displayName: 'Alex Sommer', isMe: true }],
  watchedByMe: null,
  labels: [{ name: 'web', color: '#3584e4' }],
  url: 'https://boards.example.org/b/relaunch/card/c1',
  version: 'v7',
  updated: '2026-11-17T08:00:00Z',
};

const body = encodeBoardBody({ columns: COLUMNS, cards: [CARD] });

export default async () => {
  await describe('board cache keys', async () => {
    await it('prefixes the account part, so a board never lands on a task list', async () => {
      const key = boardCacheKey('home', 'tasks');
      expect(key.account).toBe(`${BOARD_CACHE_PREFIX}home`);
      expect(key.source).toBe('tasks');
      expect(isBoardCacheKey(key)).toBe(true);
      expect(isBoardCacheKey({ account: 'home', source: 'tasks' })).toBe(false);
    });

    await it('names the source a key belongs to', async () => {
      expect(boardSourceOfCacheKey(boardCacheKey('studio', 'relaunch'))).toBe('studio');
      expect(boardSourceOfCacheKey({ account: 'studio', source: 'relaunch' })).toBeNull();
    });
  });

  await describe('board bodies', async () => {
    await it('comes back as what went in', async () => {
      const decoded = decodeBoardBody(body);
      expect(decoded?.columns).toStrictEqual(COLUMNS);
      expect(decoded?.cards).toStrictEqual([CARD]);
    });

    await it('keeps the fields a source may leave empty', async () => {
      const bare: Card = { ...CARD, due: null, url: null, version: null, updated: null, labels: [] };
      const decoded = decodeBoardBody(encodeBoardBody({ columns: [], cards: [bare] }));
      expect(decoded?.cards[0]).toStrictEqual(bare);
    });

    await it('reads a damaged file as a miss, not as an error', async () => {
      expect(decodeBoardBody('')).toBeNull();
      expect(decodeBoardBody('{"columns":')).toBeNull();
      expect(decodeBoardBody('[]')).toBeNull();
      expect(decodeBoardBody('{"columns":[],"cards":"none"}')).toBeNull();
    });

    await it('refuses a body whose card lost a field', async () => {
      const broken = JSON.parse(body) as { cards: Record<string, unknown>[] };
      delete broken.cards[0].sourceColumn;
      expect(decodeBoardBody(JSON.stringify(broken))).toBeNull();
    });

    await it('refuses a field of the wrong type rather than guessing one', async () => {
      const wrongColumn = {
        columns: [{ name: 'To do', position: 'first', closed: false, initial: true }],
        cards: [],
      };
      expect(decodeBoardBody(JSON.stringify(wrongColumn))).toBeNull();
      const wrongUser = JSON.parse(body) as { cards: { assignees: Record<string, unknown>[] }[] };
      wrongUser.cards[0].assignees[0].isMe = 'yes';
      expect(decodeBoardBody(JSON.stringify(wrongUser))).toBeNull();
    });
  });
};
