import GObject from '@girs/gobject-2.0';
import Gtk from '@girs/gtk-4.0';

import { ensureStyles } from './styles.ts';
import { Tint } from './tint.ts';

/**
 * A round check button in an arbitrary source colour. It is a plain `Gtk.CheckButton`, so
 * `active`, `notify::active` and `toggled` are the toggle API; the accessible label is required.
 */
export class ColorCheck extends Gtk.CheckButton {
  static {
    GObject.registerClass({ GTypeName: 'GjsifyAdwColorCheck' }, ColorCheck);
  }

  private readonly tint: Tint;

  constructor(label: string, colour: string | null = null) {
    super({ valign: Gtk.Align.CENTER, tooltipText: label });
    ensureStyles();
    this.add_css_class('selection-mode');
    this.setAccessibleLabel(label);
    this.tint = new Tint(
      this,
      (cls, c) =>
        `checkbutton.${cls} check { border-color: ${c}; color: white; }` +
        `checkbutton.${cls} check:checked { background-color: ${c}; border-color: ${c}; }`,
    );
    this.tint.set(colour);
  }

  setColour(colour: string | null): void {
    this.tint.set(colour);
  }

  setAccessibleLabel(label: string): void {
    this.update_property([Gtk.AccessibleProperty.LABEL], [label]);
    this.set_tooltip_text(label);
  }
}
