import { describe, expect, it } from '@gjsify/unit';
import {
  boardTarget,
  CAPABILITIES,
  ConfigError,
  GrantDeniedError,
  isBoardTarget,
  isGranted,
  parseGrants,
  requireGrant,
} from '@reminder/core';

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return null;
}

export default async () => {
  await describe('grants', async () => {
    const grants = parseGrants([{ capability: 'calendar.create', target: 'cal-work' }]);

    await it('matches capability and target exactly', async () => {
      expect(isGranted(grants, 'calendar.create', 'cal-work')).toBe(true);
      expect(isGranted(grants, 'calendar.create', 'cal-Work')).toBe(false);
      expect(isGranted(grants, 'calendar.create', 'cal-work-2')).toBe(false);
      expect(isGranted(grants, 'reminder.create', 'cal-work')).toBe(false);
    });

    await it('denies when nothing is granted', async () => {
      const err = thrown(() => requireGrant([], 'reminder.create', 'list-1'));
      expect(err instanceof GrantDeniedError).toBe(true);
      expect((err as Error).message).toContain('"capability": "reminder.create"');
    });

    await it('rejects a wildcard, an empty target and an unknown capability at load', async () => {
      expect(
        thrown(() => parseGrants([{ capability: 'calendar.create', target: '*' }])) instanceof ConfigError,
      ).toBe(true);
      expect(
        thrown(() => parseGrants([{ capability: 'calendar.create', target: ' ' }])) instanceof ConfigError,
      ).toBe(true);
      expect(
        thrown(() => parseGrants([{ capability: 'calendar.delete', target: 'x' }])) instanceof ConfigError,
      ).toBe(true);
      expect(thrown(() => parseGrants({})) instanceof ConfigError).toBe(true);
    });

    await it('knows the three board capabilities', async () => {
      for (const capability of ['board.move', 'board.update', 'board.create'])
        expect((CAPABILITIES as readonly string[]).includes(capability)).toBe(true);
    });

    await it('parses a board grant as <source>:<board> and matches it exactly', async () => {
      const board = parseGrants([{ capability: 'board.move', target: 'work:42' }]);
      expect(board.length).toBe(1);
      expect(boardTarget('work', '42')).toBe('work:42');
      expect(isGranted(board, 'board.move', 'work:42')).toBe(true);
      expect(isGranted(board, 'board.move', 'work:43')).toBe(false);
      expect(isGranted(board, 'board.move', 'work')).toBe(false);
      expect(isGranted(board, 'board.update', 'work:42')).toBe(false);
      expect(thrown(() => requireGrant(board, 'board.create', 'work:42')) instanceof GrantDeniedError).toBe(
        true,
      );
    });

    await it('rejects a board grant that names a source without a board, or a wildcard', async () => {
      for (const target of ['work', 'work:', ':42', 'work:*', '*'])
        expect(thrown(() => parseGrants([{ capability: 'board.move', target }])) instanceof ConfigError).toBe(
          true,
        );
      expect(isBoardTarget('work:42')).toBe(true);
      expect(isBoardTarget('work')).toBe(false);
    });

    await it('treats a missing list as no grants', async () => {
      expect(parseGrants(undefined)).toEqualArray([]);
    });
  });
};
