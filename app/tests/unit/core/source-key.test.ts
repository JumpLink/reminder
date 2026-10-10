import { describe, expect, it } from '@gjsify/unit';
import { sourceKey, uidForSourceKey } from '@reminder/core';

export default async () => {
  await describe('source key', async () => {
    await it('joins source and id', async () => {
      expect(sourceKey('mail', '<abc@example.org>')).toBe('mail:<abc@example.org>');
    });

    await it('rejects a bad source, an empty id and a line break', async () => {
      expect(() => sourceKey('bad source', 'x')).toThrow();
      expect(() => sourceKey('mail', '')).toThrow();
      expect(() => sourceKey('mail', 'a\r\nUID:evil')).toThrow();
    });

    await it('derives a stable 128-bit UID', async () => {
      const uid = uidForSourceKey('mail:<abc@example.org>');
      expect(uid).toMatch(/^reminder-[0-9a-f]{32}$/);
      expect(uidForSourceKey('mail:<abc@example.org>')).toBe(uid);
      expect(uidForSourceKey('mail:<abd@example.org>') === uid).toBe(false);
    });
  });
};
