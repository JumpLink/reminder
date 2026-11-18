import { describe, expect, it } from '@gjsify/unit';

import {
  BREAKPOINT_CONDITIONS,
  COMPACT_MAX_SP,
  SIZE_CLASSES,
  WIDE_MIN_SP,
  sizeClassFor,
} from '../../../src/frontends/gui/constants.ts';

// The ladder of ADR 0012: one class at every width, no gap and no overlap between rungs.
export default async () => {
  await describe('GUI size classes', async () => {
    await it('puts the thresholds at 600 and 1024 sp', async () => {
      expect(COMPACT_MAX_SP).toBe(600);
      expect(WIDE_MIN_SP).toBe(1024);
    });

    await it('maps a width to exactly one class', async () => {
      expect(sizeClassFor(360)).toBe('compact');
      expect(sizeClassFor(599)).toBe('compact');
      expect(sizeClassFor(600)).toBe('medium');
      expect(sizeClassFor(1023)).toBe('medium');
      expect(sizeClassFor(1024)).toBe('wide');
      expect(sizeClassFor(2560)).toBe('wide');
    });

    await it('writes one breakpoint condition per class from the same numbers', async () => {
      expect(SIZE_CLASSES.length).toBe(3);
      expect(BREAKPOINT_CONDITIONS.compact).toBe('max-width: 599sp');
      expect(BREAKPOINT_CONDITIONS.medium).toBe('min-width: 600sp and max-width: 1023sp');
      expect(BREAKPOINT_CONDITIONS.wide).toBe('min-width: 1024sp');
    });
  });
};
