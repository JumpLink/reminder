/** The accounts page: the list with each account's state, and the ways to add one. */

import Adw from '@girs/adw-1';
import Gtk from '@girs/gtk-4.0';

import { _, errorMessage } from '@reminder/core';

import { createAccountAdd } from './account-add.ts';
import { createAccountDetail } from './account-detail.ts';
import { accountRows, addSystemAccounts, canAddSystemAccounts } from './controller.ts';
import type { PageContext, PrefsPage } from './page-context.ts';

function addRow(title: string, subtitle: string): Adw.ActionRow {
  const row = new Adw.ActionRow({ title, subtitle, activatable: true });
  row.add_prefix(Gtk.Image.new_from_icon_name('list-add-symbolic'));
  return row;
}

export function createAccountsPage(ctx: PageContext): PrefsPage {
  const page = new Adw.PreferencesPage({
    name: 'accounts',
    title: _('Accounts'),
    iconName: 'avatar-default-symbolic',
  });
  const list = new Adw.PreferencesGroup({
    title: _('Accounts'),
    description: _('Open an account to choose which calendars and task lists are kept.'),
  });
  const add = new Adw.PreferencesGroup();
  page.add(list);
  page.add(add);
  let rows: Gtk.Widget[] = [];

  const caldav = addRow(
    _('Add CalDAV account'),
    ctx.demo ? _('Not available in demo mode') : _('Any server that speaks CalDAV'),
  );
  caldav.set_sensitive(!ctx.demo);
  caldav.connect('activated', () => ctx.dialog.push_subpage(createAccountAdd(ctx)));
  add.add(caldav);

  const system = addRow(_('Add system calendars'), _('The calendars of your desktop accounts'));
  system.connect('activated', () => {
    system.set_sensitive(false);
    void addSystemAccounts(ctx.env).then((outcome) => {
      system.set_sensitive(true);
      ctx.toast(outcome.ok ? _('System calendars added') : outcome.message);
      ctx.reload();
    });
  });
  add.add(system);

  // Hidden on purpose: not built yet, kept so the next person finds where it goes.
  const todo = new Adw.ActionRow({
    title: 'TODO: Nextcloud sign-in (Login Flow v2) and GNOME Online Accounts',
    visible: false,
  });
  add.add(todo);

  const refresh = (): void => {
    for (const row of rows) list.remove(row);
    rows = [];
    try {
      const config = ctx.env.store.read();
      for (const account of accountRows(config, ctx.env.failures())) {
        const row = new Adw.ActionRow({
          title: account.id,
          subtitle: account.problem ?? account.detail,
          subtitleLines: 2,
          activatable: true,
        });
        row.add_prefix(
          Gtk.Image.new_from_icon_name(
            account.problem ? 'dialog-warning-symbolic' : 'object-select-symbolic',
          ),
        );
        row.add_suffix(Gtk.Image.new_from_icon_name('go-next-symbolic'));
        row.connect('activated', () => ctx.dialog.push_subpage(createAccountDetail(ctx, account.id)));
        list.add(row);
        rows.push(row);
      }
      system.set_visible(!ctx.demo && canAddSystemAccounts(config));
    } catch (err) {
      const row = new Adw.ActionRow({
        title: _('The configuration cannot be read'),
        subtitle: errorMessage(err),
      });
      list.add(row);
      rows.push(row);
    }
  };
  return { page, refresh };
}
