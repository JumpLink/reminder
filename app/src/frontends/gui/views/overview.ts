/**
 * The quick overview: every calendar and task list with an on/off switch, in the container the
 * size class has room for — a bottom sheet while compact (opened by a header button), an overlay
 * sidebar while medium, a docked sidebar while wide.
 *
 * Switching a row off sets the "hidden" level: a filter on what the views paint, remembered by the
 * caller. It is not "disabled" (docs/adr/0006); nothing here reaches the core.
 */

import Adw from '@girs/adw-1';
import Gtk from '@girs/gtk-4.0';
import { SourceList } from '@gjsify/adwaita-extended';

import { _, type CalendarInfo } from '@reminder/core';

import type { SizeClass } from '../constants.ts';
import { onSignal } from '../signals.ts';
import { buildSourceSections, overviewContainerFor } from '../view-model.ts';

export interface Overview {
  /** Wraps `content`; set this where the content was meant to go. */
  widget: Gtk.Widget;
  /** Goes into the header bar; only visible where the list is not docked. */
  button: Gtk.ToggleButton;
  setSizeClass(sizeClass: SizeClass): void;
  setSources(calendars: readonly CalendarInfo[], hidden: ReadonlySet<string>): void;
  /** One line about sources that are not up to date, or null to clear it. */
  setBanner(text: string | null): void;
}

export function createOverview(
  content: Gtk.Widget,
  onToggled: (target: string, visible: boolean) => void,
): Overview {
  const list = new SourceList();
  onSignal(list, 'source-toggled', (_self: unknown, id: string, visible: boolean) => onToggled(id, visible));

  const banner = new Gtk.Label({ wrap: true, xalign: 0, visible: false });
  banner.add_css_class('caption');
  banner.add_css_class('warning');

  const body = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 12 });
  body.set_margin_start(12);
  body.set_margin_end(12);
  body.set_margin_top(12);
  body.set_margin_bottom(12);
  body.append(list);
  body.append(banner);
  const scroller = new Gtk.ScrolledWindow({
    hscrollbarPolicy: Gtk.PolicyType.NEVER,
    vexpand: true,
    child: body,
  });

  const panel = new Adw.ToolbarView();
  panel.add_top_bar(
    new Adw.HeaderBar({
      showEndTitleButtons: false,
      showStartTitleButtons: false,
      titleWidget: new Adw.WindowTitle({ title: _('Sources'), subtitle: '' }),
    }),
  );
  panel.set_content(scroller);

  const split = new Adw.OverlaySplitView({
    collapsed: true,
    showSidebar: false,
    minSidebarWidth: 240,
    maxSidebarWidth: 320,
    content,
  });
  const sheet = new Adw.BottomSheet({ showDragHandle: true });
  sheet.set_content(split);

  const label = _('Sources');
  const button = new Gtk.ToggleButton({ iconName: 'sidebar-show-symbolic', tooltipText: label });
  button.update_property([Gtk.AccessibleProperty.LABEL], [label]);

  let syncing = false;
  let container = overviewContainerFor('medium');
  const mirror = (open: boolean): void => {
    syncing = true;
    button.set_active(open);
    syncing = false;
  };
  button.connect('toggled', () => {
    if (syncing) return;
    if (container === 'bottom-sheet') sheet.set_open(button.active);
    else if (container === 'overlay') split.set_show_sidebar(button.active);
  });
  sheet.connect('notify::open', () => {
    if (container === 'bottom-sheet') mirror(sheet.open);
  });
  split.connect('notify::show-sidebar', () => {
    if (container === 'overlay') mirror(split.showSidebar);
  });

  const empty = (): void => {
    if (sheet.get_sheet() === panel) {
      sheet.set_open(false);
      sheet.set_sheet(null);
    }
    if (split.get_sidebar() === panel) {
      split.set_show_sidebar(false);
      split.set_sidebar(null);
    }
  };

  const setSizeClass = (sizeClass: SizeClass): void => {
    container = overviewContainerFor(sizeClass);
    empty();
    mirror(false);
    button.set_visible(container !== 'docked');
    switch (container) {
      case 'bottom-sheet':
        split.set_collapsed(true);
        sheet.set_sheet(panel);
        break;
      case 'overlay':
        split.set_collapsed(true);
        split.set_sidebar(panel);
        break;
      case 'docked':
        split.set_collapsed(false);
        split.set_sidebar(panel);
        split.set_show_sidebar(true);
        break;
    }
  };
  setSizeClass('medium');

  return {
    widget: sheet,
    button,
    setSizeClass,
    setSources: (calendars, hidden) => list.setSections(buildSourceSections(calendars, hidden)),
    setBanner(text) {
      banner.set_label(text ?? '');
      banner.set_visible(text !== null);
    },
  };
}
