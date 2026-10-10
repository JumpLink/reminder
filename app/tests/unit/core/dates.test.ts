import { describe, expect, it } from '@gjsify/unit';
import { capLimit, EVENT_LIMIT, shiftDate, todayUtc, toInstant } from '@reminder/core';

export default async () => {
  await describe('dates and limits', async () => {
    await it('shifts across a month end', async () => {
      expect(shiftDate('2026-10-31', 1)).toBe('2026-11-01');
      expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28');
      expect(() => shiftDate('2026-13-01', 1)).toThrow();
    });

    await it('turns a bound into a UTC instant', async () => {
      expect(toInstant('2026-10-12')).toBe('2026-10-12T00:00:00.000Z');
      expect(toInstant('2026-10-12T10:00:00+02:00')).toBe('2026-10-12T08:00:00.000Z');
      expect(() => toInstant('soon')).toThrow();
    });

    await it('reads today in UTC', async () => {
      expect(todayUtc(new Date('2026-10-10T23:30:00-02:00'))).toBe('2026-10-11');
    });

    await it('clamps a limit into [1, max]', async () => {
      expect(capLimit(undefined, EVENT_LIMIT)).toBe(EVENT_LIMIT.default);
      expect(capLimit(0, EVENT_LIMIT)).toBe(1);
      expect(capLimit(10_000, EVENT_LIMIT)).toBe(EVENT_LIMIT.max);
      expect(capLimit(7.9, EVENT_LIMIT)).toBe(7);
    });
  });
};
