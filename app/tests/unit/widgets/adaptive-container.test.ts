import { describe, expect, it } from '@gjsify/unit';
import { containerFor } from '@gjsify/adwaita-extended/adaptive-container';

export default async () => {
  await describe('containerFor', async () => {
    await it('puts wide in an inspector, medium in a dialog, compact in a sheet', async () => {
      expect(containerFor('wide')).toBe('inspector');
      expect(containerFor('medium')).toBe('dialog');
      expect(containerFor('compact')).toBe('sheet');
    });
  });
};
