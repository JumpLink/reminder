import Adw from '@girs/adw-1';
import GObject from '@girs/gobject-2.0';
import Gtk from '@girs/gtk-4.0';

import { emitSignal } from './signals.ts';
import { containerFor, type PaneContainer } from './adaptive-container.ts';
import { _ } from './i18n.ts';
import type { SizeClass } from './size-class.ts';

/**
 * One content widget, shown where the window has room for it: wide → inspector on the end side,
 * medium → `Adw.Dialog`, compact → `Adw.BottomSheet`.
 *
 * The pane owns the split view and the sheet, so the caller hands over its main content with
 * `setMain` instead of wiring three containers. A single `Adw.ToolbarView` (header + content) is
 * what moves between containers, so the content keeps its state (scroll, entries) when the size
 * class changes. Signal `closed` fires when the user dismisses the pane, not on `close()`.
 */
export class AdaptivePane extends Adw.Bin {
  static {
    GObject.registerClass({ GTypeName: 'GjsifyAdwAdaptivePane', Signals: { closed: {} } }, AdaptivePane);
  }

  private sizeClass: SizeClass = 'compact';
  private open: PaneContainer | null = null;
  private moving = false;
  private readonly split = new Adw.OverlaySplitView({
    sidebarPosition: Gtk.PackType.END,
    collapsed: false,
    showSidebar: false,
    minSidebarWidth: 320,
    maxSidebarWidth: 420,
  });
  private readonly sheet = new Adw.BottomSheet({ showDragHandle: true });
  private readonly shell = new Adw.ToolbarView();
  private readonly header = new Adw.HeaderBar({ showEndTitleButtons: false, showStartTitleButtons: false });
  private readonly title = new Adw.WindowTitle({ title: '', subtitle: '' });
  private dialog: Adw.Dialog | null = null;

  constructor() {
    super();
    this.title.set_title('');
    this.header.set_title_widget(this.title);
    const close = Gtk.Button.new_from_icon_name('window-close-symbolic');
    close.add_css_class('flat');
    close.set_tooltip_text(_('Close'));
    close.update_property([Gtk.AccessibleProperty.LABEL], [_('Close')]);
    close.connect('clicked', () => this.dismiss());
    this.header.pack_end(close);
    this.shell.add_top_bar(this.header);

    this.sheet.set_content(this.split);
    this.set_child(this.sheet);
    this.sheet.connect('notify::open', () => {
      if (!this.sheet.open && !this.moving && this.open === 'sheet') this.dismissed();
    });
  }

  setMain(widget: Gtk.Widget | null): void {
    this.split.set_content(widget);
  }

  get container(): PaneContainer | null {
    return this.open;
  }

  setSizeClass(sizeClass: SizeClass): void {
    this.sizeClass = sizeClass;
    if (this.open !== null && this.open !== containerFor(sizeClass)) this.place();
  }

  present(content: Gtk.Widget, title: string): void {
    this.shell.set_content(content);
    this.title.set_title(title);
    this.place();
  }

  /** Hides the pane without emitting `closed`; the content stays alive for the next `present`. */
  close(): void {
    this.remove();
    this.open = null;
  }

  private dismiss(): void {
    this.close();
    this.dismissed();
  }

  private dismissed(): void {
    this.open = null;
    emitSignal(this, 'closed');
  }

  private place(): void {
    const target = containerFor(this.sizeClass);
    this.moving = true;
    this.remove();
    switch (target) {
      case 'inspector':
        this.split.set_sidebar(this.shell);
        this.split.set_show_sidebar(true);
        break;
      case 'sheet':
        this.sheet.set_sheet(this.shell);
        this.sheet.set_open(true);
        break;
      case 'dialog': {
        const dialog = new Adw.Dialog({ contentWidth: 480, contentHeight: 520 });
        dialog.set_child(this.shell);
        dialog.connect('closed', () => {
          if (this.dialog === dialog && !this.moving) {
            this.dialog = null;
            this.dismissed();
          }
        });
        this.dialog = dialog;
        dialog.present(this);
        break;
      }
    }
    this.open = target;
    this.moving = false;
  }

  /** Empties whichever container holds the shell, so it can be set into another. */
  private remove(): void {
    const was = this.moving;
    this.moving = true;
    if (this.dialog) {
      const dialog = this.dialog;
      this.dialog = null;
      dialog.set_child(null);
      dialog.force_close();
    }
    if (this.sheet.get_sheet() === this.shell) {
      this.sheet.set_open(false);
      this.sheet.set_sheet(null);
    }
    if (this.split.get_sidebar() === this.shell) {
      this.split.set_show_sidebar(false);
      this.split.set_sidebar(null);
    }
    this.moving = was;
  }
}
