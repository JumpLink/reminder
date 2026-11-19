/** What every preferences page gets from the dialog that hosts it. */

import type Adw from '@girs/adw-1';

import type { PreferencesEnv } from './controller.ts';

export interface PrefsPage {
  page: Adw.PreferencesPage;
  /** Re-read the configuration and repaint; called after every change. */
  refresh(): void;
}

export interface PageContext {
  dialog: Adw.PreferencesDialog;
  env: PreferencesEnv;
  /** Demo mode: nothing is written, and no account can be added. */
  demo: boolean;
  toast(message: string): void;
  /** Every open page repaints. */
  reload(): void;
  /** Repaint a sub page on `reload`; returns the way to stop. */
  onReload(listener: () => void): () => void;
}
