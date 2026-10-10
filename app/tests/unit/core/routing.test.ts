import { describe, expect, it } from '@gjsify/unit';
import {
  ConfigError,
  parseDefaults,
  parseRoutes,
  resolveTarget,
  RoutingError,
  type RoutingConfig,
} from '@reminder/core';

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return null;
}

const config: RoutingConfig = {
  routes: parseRoutes([
    { concerns: ['Invoice', 'tax'], kind: 'reminder', target: 'list-finance' },
    { concerns: ['invoice'], target: 'cal-finance' },
    { concerns: ['school'], target: 'cal-family' },
  ]),
  defaults: parseDefaults({ event: 'cal-default' }),
};

export default async () => {
  await describe('routing', async () => {
    await it('lets an explicit calendar win', async () => {
      expect(resolveTarget(config, { kind: 'event', calendar: 'cal-x', concern: 'school' })).toBe('cal-x');
    });

    await it('matches a concern case-insensitively and respects kind', async () => {
      expect(resolveTarget(config, { kind: 'reminder', concern: 'INVOICE' })).toBe('list-finance');
      expect(resolveTarget(config, { kind: 'event', concern: 'invoice' })).toBe('cal-finance');
    });

    await it('falls back to the default for the kind', async () => {
      expect(resolveTarget(config, { kind: 'event', concern: 'unknown' })).toBe('cal-default');
      expect(resolveTarget(config, { kind: 'event' })).toBe('cal-default');
    });

    await it('errors when nothing names a target', async () => {
      expect(
        thrown(() => resolveTarget(config, { kind: 'reminder', concern: 'unknown' })) instanceof RoutingError,
      ).toBe(true);
    });

    await it('validates routes and defaults', async () => {
      expect(thrown(() => parseRoutes([{ concerns: [], target: 'x' }])) instanceof ConfigError).toBe(true);
      expect(
        thrown(() => parseRoutes([{ concerns: ['a'], kind: 'note', target: 'x' }])) instanceof ConfigError,
      ).toBe(true);
      expect(thrown(() => parseDefaults({ todo: 'x' })) instanceof ConfigError).toBe(true);
    });
  });
};
