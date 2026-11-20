/** The form for a local list: a name and a colour. The list is a folder of .ics files you own. */

import Adw from '@girs/adw-1';
import Gdk from '@girs/gdk-4.0';
import Gtk from '@girs/gtk-4.0';

import { _ } from '@reminder/core';
import { vdirRoot } from '@reminder/vdir';

import { IDENTITY } from '../../../../core/identity.ts';
import { createLocalList } from './controller.ts';
import type { PageContext } from './page-context.ts';

const DEFAULT_COLOR = '#3584e4';

const hex = (value: number): string =>
  Math.round(Math.max(0, Math.min(1, value)) * 255)
    .toString(16)
    .padStart(2, '0');

export function createLocalListAdd(ctx: PageContext): Adw.NavigationPage {
  const prefs = new Adw.PreferencesPage();
  const form = new Adw.PreferencesGroup({
    description: _('The list is stored as plain files on this computer, so other tools can read it.'),
  });
  const name = new Adw.EntryRow({ title: _('Name') });
  const swatch = new Gtk.ColorDialogButton({ dialog: new Gtk.ColorDialog(), valign: Gtk.Align.CENTER });
  const initial = new Gdk.RGBA();
  initial.parse(DEFAULT_COLOR);
  swatch.set_rgba(initial);
  const color = new Adw.ActionRow({ title: _('Colour') });
  color.add_suffix(swatch);
  color.set_activatable_widget(swatch);
  form.add(name);
  form.add(color);

  const error = new Gtk.Label({ wrap: true, xalign: 0, visible: false });
  error.add_css_class('error');
  const submit = new Adw.ButtonRow({ title: _('Create list') });
  submit.add_css_class('suggested-action');
  const actions = new Adw.PreferencesGroup();
  actions.add(submit);
  const note = new Adw.PreferencesGroup();
  note.add(error);
  prefs.add(form);
  prefs.add(actions);
  prefs.add(note);

  submit.connect('activated', () => {
    submit.set_sensitive(false);
    error.set_visible(false);
    const rgba = swatch.get_rgba();
    void createLocalList(ctx.env, {
      name: name.text,
      color: `#${hex(rgba.red)}${hex(rgba.green)}${hex(rgba.blue)}`,
      root: vdirRoot(IDENTITY.dataDirName, process.env),
    }).then((outcome) => {
      submit.set_sensitive(true);
      if (outcome.ok) {
        ctx.dialog.pop_subpage();
        ctx.toast(_('List created'));
        ctx.reload();
        return;
      }
      error.set_label(outcome.message);
      error.set_visible(true);
    });
  });

  const toolbar = new Adw.ToolbarView();
  toolbar.add_top_bar(new Adw.HeaderBar());
  toolbar.set_content(prefs);
  return new Adw.NavigationPage({ child: toolbar, title: _('Create local list') });
}
