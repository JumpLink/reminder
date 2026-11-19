import { describe, expect, it } from '@gjsify/unit';
import {
  ConfigError,
  boardConfigKey,
  emptyBoardsConfig,
  mineFor,
  overridesFor,
  parseBoards,
  parseConfig,
  serializeConfig,
  type BoardsConfig,
} from '@reminder/core';

import { normalizeConfig } from '../../../src/core/config-write.ts';

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return null;
}

const CONFIGURED = {
  mine: 'all',
  sources: { work: { mine: 'watching' } },
  columns: { 'work:42': { Wartet: 'backlog', 'Im Review': 'in-progress' } },
};

export default async () => {
  await describe('board configuration', async () => {
    await it('is empty until a person names a board', async () => {
      const boards = parseConfig({}).boards;
      expect(boards.mine).toBe('assigned');
      expect(Object.keys(boards.sources).length).toBe(0);
      expect(Object.keys(boards.columns).length).toBe(0);
    });

    await it('reads the default filter, the per-source one and the overrides', async () => {
      const boards = parseBoards(CONFIGURED);
      expect(boards.mine).toBe('all');
      expect(boards.sources.work?.mine).toBe('watching');
      expect(boards.columns['work:42']?.Wartet).toBe('backlog');
    });

    await it('refuses a filter, a lane or a shape it does not know', async () => {
      for (const bad of [
        [],
        'x',
        { mine: 'everyone' },
        { nope: 1 },
        { sources: [] },
        { sources: { work: { mine: 'everyone' } } },
        { sources: { work: { filter: 'assigned' } } },
        { columns: { 'work:42': { Wartet: 'someday' } } },
        { columns: { 'work:42': 'backlog' } },
      ]) {
        expect(thrown(() => parseBoards(bad)) instanceof ConfigError).toBe(true);
      }
    });

    await it('writes nothing back when nothing was configured', async () => {
      const again = JSON.parse(serializeConfig(parseConfig({}))) as Record<string, unknown>;
      expect('boards' in again).toBe(false);
    });

    await it('survives a round trip through the file, unknown keys and all', async () => {
      const config = normalizeConfig(parseConfig({ boards: CONFIGURED, future: { a: 1 } }));
      expect(config.boards.mine).toBe('all');
      expect(config.boards.sources.work?.mine).toBe('watching');
      expect(config.boards.columns['work:42']?.['Im Review']).toBe('in-progress');
      const again = JSON.parse(serializeConfig(config)) as Record<string, unknown>;
      expect(JSON.stringify(again.future)).toBe('{"a":1}');
      expect(JSON.stringify(again.boards)).toBe(JSON.stringify(CONFIGURED));
    });

    await it('keeps a source section that only says the default filter', async () => {
      const boards = parseBoards({ sources: { work: {} } });
      expect('work' in boards.sources).toBe(true);
      expect(boards.sources.work?.mine).toBe(undefined);
      expect(mineFor(boards, 'work')).toBe('assigned');
    });

    await it('answers the filter of the source, then the section, then assigned', async () => {
      const boards = parseBoards(CONFIGURED);
      expect(mineFor(boards, 'work')).toBe('watching');
      expect(mineFor(boards, 'home')).toBe('all');
      expect(mineFor(emptyBoardsConfig(), 'home')).toBe('assigned');
    });

    await it('hands the rules a key they match, whatever the file spelled', async () => {
      const boards: BoardsConfig = parseBoards(CONFIGURED);
      const board = { source: 'work', id: '42' };
      expect(boardConfigKey(board)).toBe('work:42');
      const overrides = overridesFor(boards, board);
      expect(overrides.wartet).toBe('backlog');
      expect(overrides.imreview).toBe('in-progress');
      expect(Object.keys(overridesFor(boards, { source: 'work', id: '7' })).length).toBe(0);
    });
  });
};
