import Adw from '@girs/adw-1';
import Gdk from '@girs/gdk-4.0';
import Gtk from '@girs/gtk-4.0';

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
let counter = 0;

/** Only plain hex reaches the CSS text: a source colour is data from a server, not trusted markup. */
export function isHexColour(value: string): boolean {
  return HEX.test(value.trim());
}

/**
 * Paints one widget in an arbitrary colour through its own CSS provider. `rules(cls, colour)` returns
 * the CSS for the widget's unique class; on a dark theme the colour is lifted toward white so a deep
 * source colour stays visible. The provider lives on the display only while the widget is realized.
 */
export class Tint {
  private readonly provider = new Gtk.CssProvider();
  private readonly cls = `gjsify-tint-${++counter}`;
  private readonly widget: Gtk.Widget;
  private readonly rules: (cls: string, colour: string) => string;
  private colour: string | null = null;
  private attached = false;

  constructor(widget: Gtk.Widget, rules: (cls: string, colour: string) => string) {
    this.widget = widget;
    this.rules = rules;
    widget.add_css_class(this.cls);
    widget.connect('realize', () => this.attach());
    widget.connect('unrealize', () => this.detach());
    Adw.StyleManager.get_default().connect('notify::dark', () => this.render());
  }

  set(colour: string | null): void {
    this.colour = colour !== null && isHexColour(colour) ? colour.trim() : null;
    this.render();
  }

  private render(): void {
    if (this.colour === null) {
      this.provider.load_from_string('');
      return;
    }
    const dark = Adw.StyleManager.get_default().dark;
    const colour = dark ? `mix(${this.colour}, white, 0.3)` : this.colour;
    this.provider.load_from_string(this.rules(this.cls, colour));
  }

  private attach(): void {
    if (this.attached) return;
    const display = Gdk.Display.get_default();
    if (!display) return;
    Gtk.StyleContext.add_provider_for_display(display, this.provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    this.attached = true;
  }

  private detach(): void {
    if (!this.attached) return;
    const display = Gdk.Display.get_default();
    if (display) Gtk.StyleContext.remove_provider_for_display(display, this.provider);
    this.attached = false;
  }
}
