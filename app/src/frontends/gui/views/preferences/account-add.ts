/** The form for a manual CalDAV account. The password goes to the secret store, never to the file. */

import Adw from '@girs/adw-1';
import Gtk from '@girs/gtk-4.0';

import { _ } from '@reminder/core';

import { addCaldavAccount } from './controller.ts';
import type { PageContext } from './page-context.ts';

export function createAccountAdd(ctx: PageContext): Adw.NavigationPage {
  const prefs = new Adw.PreferencesPage();
  const form = new Adw.PreferencesGroup({
    description: _('The password is kept in your desktop keyring, not in the configuration file.'),
  });
  const name = new Adw.EntryRow({ title: _('Name (optional)') });
  const url = new Adw.EntryRow({ title: _('Server address') });
  const user = new Adw.EntryRow({ title: _('User name') });
  const password = new Adw.PasswordEntryRow({ title: _('Password') });
  for (const row of [name, url, user, password]) form.add(row);

  const error = new Gtk.Label({ wrap: true, xalign: 0, visible: false });
  error.add_css_class('error');
  const submit = new Adw.ButtonRow({ title: _('Add account') });
  submit.add_css_class('suggested-action');
  const actions = new Adw.PreferencesGroup();
  actions.add(submit);
  prefs.add(form);
  prefs.add(actions);
  const note = new Adw.PreferencesGroup();
  note.add(error);
  prefs.add(note);

  submit.connect('activated', () => {
    submit.set_sensitive(false);
    error.set_visible(false);
    void addCaldavAccount(ctx.env, {
      name: name.text,
      url: url.text,
      username: user.text,
      password: password.text,
    }).then((outcome) => {
      submit.set_sensitive(true);
      if (outcome.ok) {
        ctx.dialog.pop_subpage();
        ctx.toast(_('Account added'));
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
  return new Adw.NavigationPage({ child: toolbar, title: _('Add CalDAV account') });
}
