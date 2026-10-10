import { describe, expect, it } from '@gjsify/unit';
import { ConfigError, GrantDeniedError, isGranted, parseGrants, requireGrant } from '@reminder/core';

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

    await it('treats a missing list as no grants', async () => {
      expect(parseGrants(undefined)).toEqualArray([]);
    });
  });
};
