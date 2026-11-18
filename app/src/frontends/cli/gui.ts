/**
 * `reminder gui` — the native GTK4/libadwaita window.
 *
 * The GUI is imported on demand: its module graph pulls in `gi://Gtk` and `gi://Adw`, which a
 * terminal run without a display (or `reminder mcp` over stdio) must never load.
 */

import type { CommandModule } from 'yargs';

import { _ } from '@reminder/core';

export const guiCommand: CommandModule = {
  command: 'gui',
  describe: _('Open the graphical interface'),
  builder: (yargs) => yargs,
  handler: () => {
    import('../gui/main.ts')
      .then(({ runGui }) => runGui())
      .then((status) => process.exit(status))
      .catch((err: unknown) => {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      });
  },
};
