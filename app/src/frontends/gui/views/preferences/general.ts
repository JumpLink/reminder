/**
 * The general page: appearance and the first day of the week. Both live in `gui.json`, not in the
 * core's configuration. The sync interval is not offered: the sync service fixes it per source kind.
 */

import Adw from '@girs/adw-1';
import Gtk from '@girs/gtk-4.0';

import { _ } from '@reminder/core';

import {
  COLOR_SCHEMES,
  WEEK_STARTS,
  type ColorScheme,
  type GuiSettings,
  type WeekStart,
} from '../../settings.ts';
import type { PageContext, PrefsPage } from './page-context.ts';

const colorSchemeLabel = (value: ColorScheme): string =>
  value === 'light' ? _('Light') : value === 'dark' ? _('Dark') : _('Follow system');

const weekStartLabel = (value: WeekStart): string => {
  switch (value) {
    case 'monday':
      return _('Monday');
    case 'sunday':
      return _('Sunday');
    case 'saturday':
      return _('Saturday');
    default:
      return _('Follow system');
  }
};

/** Also called at start, so the saved scheme is in place before the window shows. */
export function applyColorScheme(value: ColorScheme): void {
  Adw.StyleManager.get_default().set_color_scheme(
    value === 'light'
      ? Adw.ColorScheme.FORCE_LIGHT
      : value === 'dark'
        ? Adw.ColorScheme.FORCE_DARK
        : Adw.ColorScheme.DEFAULT,
  );
}

export function createGeneralPage(ctx: PageContext): PrefsPage {
  const settings: GuiSettings = ctx.env.settings;
  const page = new Adw.PreferencesPage({ title: _('General'), iconName: 'preferences-system-symbolic' });
  const look = new Adw.PreferencesGroup({ title: _('Appearance') });
  const calendar = new Adw.PreferencesGroup({ title: _('Dates') });
  page.add(look);
  page.add(calendar);

  const scheme = new Adw.ComboRow({
    title: _('Color scheme'),
    model: Gtk.StringList.new(COLOR_SCHEMES.map(colorSchemeLabel)),
  });
  const week = new Adw.ComboRow({
    title: _('First day of the week'),
    model: Gtk.StringList.new(WEEK_STARTS.map(weekStartLabel)),
  });
  look.add(scheme);
  calendar.add(week);

  const refresh = (): void => {
    scheme.set_selected(COLOR_SCHEMES.indexOf(settings.colorScheme()));
    week.set_selected(WEEK_STARTS.indexOf(settings.weekStart()));
  };
  refresh();
  scheme.connect('notify::selected', () => {
    const value = COLOR_SCHEMES[scheme.selected];
    if (value === undefined || value === settings.colorScheme()) return;
    settings.setColorScheme(value);
    applyColorScheme(value);
  });
  week.connect('notify::selected', () => {
    const value = WEEK_STARTS[week.selected];
    if (value !== undefined && value !== settings.weekStart()) settings.setWeekStart(value);
  });
  return { page, refresh };
}
