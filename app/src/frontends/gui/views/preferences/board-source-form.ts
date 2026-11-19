/** The form for an external board source. The credential goes to the secret store, never to the file. */

import Adw from '@girs/adw-1';
import Gtk from '@girs/gtk-4.0';

import { _, EXTERNAL_SOURCE_TYPES, type ExternalSourceType } from '@reminder/core';

import {
  addExternalSource,
  editExternalSource,
  removeExternalSource,
  type ExternalInput,
} from './board-controller.ts';
import type { Outcome } from './controller.ts';
import type { PageContext } from './page-context.ts';

const typeLabel = (type: ExternalSourceType): string =>
  type === 'deck' ? _('Nextcloud Deck') : type === 'openproject' ? _('OpenProject') : _('Zenkit');

/** `editing` null = a new source; otherwise the id of the one to change. */
export function createBoardSourceForm(ctx: PageContext, editing: string | null): Adw.NavigationPage {
  const prefs = new Adw.PreferencesPage();
  const current =
    editing === null ? undefined : ctx.env.store.read().boardSources.find((s) => s.id === editing);
  const form = new Adw.PreferencesGroup({
    description: _('The password or token is kept in your desktop keyring, not in the configuration file.'),
  });
  const type = new Adw.ComboRow({
    title: _('Type'),
    model: Gtk.StringList.new(EXTERNAL_SOURCE_TYPES.map(typeLabel)),
    sensitive: current === undefined,
  });
  const name = new Adw.EntryRow({ title: _('Name (optional)'), visible: current === undefined });
  const url = new Adw.EntryRow({ title: _('Server address'), text: current?.url ?? '' });
  const user = new Adw.EntryRow({ title: _('User name'), text: current?.username ?? '' });
  const secret = new Adw.PasswordEntryRow({
    title: current ? _('New password or token (empty keeps the stored one)') : _('App password or token'),
  });
  for (const row of [type, name, url, user, secret]) form.add(row);
  if (current) type.set_selected(EXTERNAL_SOURCE_TYPES.indexOf(current.type));

  const kind = (): ExternalSourceType => EXTERNAL_SOURCE_TYPES[type.selected] ?? 'deck';
  const sync = (): void => {
    user.set_visible(kind() === 'deck');
    url.set_title(kind() === 'zenkit' ? _('Server address (optional)') : _('Server address'));
  };
  type.connect('notify::selected', sync);
  sync();

  const error = new Gtk.Label({ wrap: true, xalign: 0, visible: false });
  error.add_css_class('error');
  const submit = new Adw.ButtonRow({ title: current ? _('Save') : _('Add source') });
  submit.add_css_class('suggested-action');
  const actions = new Adw.PreferencesGroup();
  actions.add(submit);
  prefs.add(form);
  prefs.add(actions);
  const note = new Adw.PreferencesGroup();
  note.add(error);
  prefs.add(note);

  const page = new Adw.NavigationPage({
    title: current ? current.id : _('Add board source'),
    child: (() => {
      const view = new Adw.ToolbarView();
      view.add_top_bar(new Adw.HeaderBar());
      view.set_content(prefs);
      return view;
    })(),
  });

  const finish = (outcome: Outcome, message: string): void => {
    submit.set_sensitive(true);
    if (!outcome.ok) {
      error.set_label(outcome.message);
      error.set_visible(true);
      return;
    }
    ctx.toast(message);
    ctx.dialog.pop_subpage();
    ctx.reload();
  };

  submit.connect('activated', () => {
    const input: ExternalInput = {
      name: name.text,
      type: kind(),
      url: url.text,
      username: user.text,
      credential: secret.text,
    };
    error.set_visible(false);
    submit.set_sensitive(false);
    void (
      editing === null ? addExternalSource(ctx.env, input) : editExternalSource(ctx.env, editing, input)
    ).then((outcome) => finish(outcome, editing === null ? _('Source added') : _('Source saved')));
  });

  if (editing !== null) {
    const danger = new Adw.PreferencesGroup();
    const remove = new Adw.ButtonRow({ title: _('Remove source') });
    remove.add_css_class('destructive-action');
    remove.connect('activated', () => {
      void removeExternalSource(ctx.env, editing).then((outcome) => finish(outcome, _('Source removed')));
    });
    danger.add(remove);
    prefs.add(danger);
  }
  return page;
}
