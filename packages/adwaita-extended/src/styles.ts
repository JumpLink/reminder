import Gdk from '@girs/gdk-4.0';
import Gtk from '@girs/gtk-4.0';

/** The package's few fixed rules; everything per-instance goes through {@link Tint}. */
const CSS = `
.gjsify-source-dot { border-radius: 50%; min-width: 8px; min-height: 8px; }
.gjsify-source-dot.large { min-width: 14px; min-height: 14px; }
.gjsify-board-column { background-color: alpha(currentColor, 0.05); border-radius: 12px; }
.gjsify-board-card { padding: 0; }
.gjsify-board-bar { min-width: 4px; border-radius: 6px 0 0 6px; }
.gjsify-board-label { padding: 0 6px; border-radius: 99px; background-color: alpha(currentColor, 0.1); }
.gjsify-board-avatar { border: 2px solid @card_bg_color; border-radius: 50%; }
.gjsify-swipe-content { background-color: @view_bg_color; }
.gjsify-swipe-backdrop.primary { background-color: @success_bg_color; color: @success_fg_color; }
.gjsify-swipe-backdrop.secondary { background-color: @warning_bg_color; color: @warning_fg_color; }
.gjsify-swipe-backdrop image { opacity: 0.55; }
.gjsify-swipe-backdrop.armed image { opacity: 1; }
.gjsify-swipe-actions button { min-width: 32px; min-height: 32px; }
`;

let loaded = false;

/** Once per process; a no-op without a display (Node-side tooling, a headless import). */
export function ensureStyles(): void {
  if (loaded) return;
  const display = Gdk.Display.get_default();
  if (!display) return;
  const provider = new Gtk.CssProvider();
  provider.load_from_string(CSS);
  Gtk.StyleContext.add_provider_for_display(display, provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
  loaded = true;
}

/** `Pango.EllipsizeMode.END`; spelled as a number so the package needs no `@girs/pango` dependency. */
export const ELLIPSIZE_END = 3;
