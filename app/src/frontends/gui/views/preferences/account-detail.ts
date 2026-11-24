/** One account: its state, a switch per calendar and task list, and removing it. */

import Adw from '@girs/adw-1';
import type Gtk from '@girs/gtk-4.0';

import { _, fmt, errorMessage } from '@reminder/core';

import {
  accountRows,
  canRemoveAccount,
  collectionRows,
  removeAccount,
  setCollectionEnabled,
  type CollectionRow,
} from './controller.ts';
import type { PageContext } from './page-context.ts';

function subtitleOf(row: CollectionRow): string {
  const kind = row.kind === 'event' ? _('Calendar') : _('Task list');
  const state = row.enabled ? _('Fetched and kept up to date') : _('No longer fetched, local copy removed');
  return fmt(_('{kind} · {state}'), { kind, state });
}

function confirmRemoval(ctx: PageContext, id: string): void {
  const dialog = new Adw.AlertDialog({
    heading: fmt(_('Remove “{account}”?'), { account: id }),
    body: _(
      'The account, its local copy and its stored password are removed from this app. Nothing changes on the server.',
    ),
  });
  dialog.add_response('cancel', _('Cancel'));
  dialog.add_response('remove', _('Remove'));
  dialog.set_response_appearance('remove', Adw.ResponseAppearance.DESTRUCTIVE);
  dialog.set_default_response('cancel');
  dialog.set_close_response('cancel');
  dialog.connect('response', (_dialog, response: string) => {
    if (response !== 'remove') return;
    void removeAccount(ctx.env, id).then((outcome) => {
      if (outcome.ok) ctx.dialog.pop_subpage();
      else ctx.toast(outcome.message);
      ctx.reload();
    });
  });
  dialog.present(ctx.dialog);
}

export function createAccountDetail(ctx: PageContext, id: string): Adw.NavigationPage {
  const prefs = new Adw.PreferencesPage();
  const state = new Adw.PreferencesGroup();
  const collections = new Adw.PreferencesGroup({
    title: _('Calendars and task lists'),
    description: _(
      'Switch one off and it is no longer fetched; its local copy is removed. Switching it on fetches it again.',
    ),
  });
  const danger = new Adw.PreferencesGroup();
  prefs.add(state);
  prefs.add(collections);
  prefs.add(danger);

  const status = new Adw.ActionRow({ subtitleLines: 3 });
  state.add(status);
  const remove = new Adw.ButtonRow({ title: _('Remove account…') });
  remove.add_css_class('destructive-action');
  remove.connect('activated', () => confirmRemoval(ctx, id));
  danger.add(remove);

  let rows: Gtk.Widget[] = [];
  const refresh = (): void => {
    for (const row of rows) collections.remove(row);
    rows = [];
    try {
      const config = ctx.env.store.read();
      const account = accountRows(config, ctx.env.failures()).find((a) => a.id === id);
      status.set_title(account?.detail ?? id);
      status.set_subtitle(account?.problem ?? _('Connected'));
      remove.set_sensitive(canRemoveAccount(config));
      danger.set_description(canRemoveAccount(config) ? '' : _('The last account cannot be removed.'));
      for (const item of collectionRows(config, ctx.env.lists(), id)) {
        const row = new Adw.SwitchRow({
          title: item.name,
          useMarkup: false,
          subtitle: subtitleOf(item),
          active: item.enabled,
        });
        row.connect('notify::active', () => {
          row.set_sensitive(false);
          void setCollectionEnabled(ctx.env, item.target, row.active).then((outcome) => {
            if (!outcome.ok) ctx.toast(outcome.message);
            ctx.reload();
          });
        });
        collections.add(row);
        rows.push(row);
      }
    } catch (err) {
      status.set_subtitle(errorMessage(err));
    }
  };

  const toolbar = new Adw.ToolbarView();
  toolbar.add_top_bar(new Adw.HeaderBar());
  toolbar.set_content(prefs);
  const page = new Adw.NavigationPage({ child: toolbar, title: id });
  const stop = ctx.onReload(refresh);
  page.connect('hidden', stop);
  refresh();
  return page;
}
