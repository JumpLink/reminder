/** The preferences dialog: three pages over one controller. */

import Adw from '@girs/adw-1';
import type Gtk from '@girs/gtk-4.0';

import { createAccountsPage } from './accounts.ts';
import { createAgentAccessPage } from './agent-access.ts';
import type { PreferencesEnv } from './controller.ts';
import { createGeneralPage } from './general.ts';
import type { PageContext, PrefsPage } from './page-context.ts';

export { applyColorScheme } from './general.ts';

export function presentPreferences(parent: Gtk.Widget, env: PreferencesEnv, demo: boolean): void {
  const dialog = new Adw.PreferencesDialog();
  const listeners = new Set<() => void>();
  const ctx: PageContext = {
    dialog,
    env,
    demo,
    toast: (message) => dialog.add_toast(new Adw.Toast({ title: message })),
    reload: () => {
      for (const listener of Array.from(listeners)) listener();
    },
    onReload: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const pages: PrefsPage[] = [createAccountsPage(ctx), createAgentAccessPage(ctx), createGeneralPage(ctx)];
  for (const entry of pages) {
    dialog.add(entry.page);
    ctx.onReload(entry.refresh);
    entry.refresh();
  }
  dialog.present(parent);
}
