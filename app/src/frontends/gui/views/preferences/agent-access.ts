/**
 * The agent access page: which writes an agent (MCP server, CLI) may make, per capability and
 * collection. A grant names ONE capability and ONE exact collection — there is no "everything".
 */

import Adw from '@girs/adw-1';
import Gtk from '@girs/gtk-4.0';

import { _, CAPABILITIES, errorMessage } from '@reminder/core';

import {
  addGrant,
  capabilityLabel,
  grantRows,
  removeGrant,
  targetChoices,
  type TargetChoice,
} from './controller.ts';
import type { PageContext, PrefsPage } from './page-context.ts';

const GRANTABLE = CAPABILITIES;

export function createAgentAccessPage(ctx: PageContext): PrefsPage {
  const page = new Adw.PreferencesPage({
    name: 'agent-access',
    title: _('Agent access'),
    iconName: 'security-high-symbolic',
  });
  const granted = new Adw.PreferencesGroup({
    title: _('Granted'),
    description: _('Agents can always read. They change something only where it is listed here.'),
  });
  const add = new Adw.PreferencesGroup({ title: _('Grant access') });
  page.add(granted);
  page.add(add);

  const capability = new Adw.ComboRow({
    title: _('May'),
    model: Gtk.StringList.new(GRANTABLE.map(capabilityLabel)),
  });
  const target = new Adw.ComboRow({ title: _('In') });
  const submit = new Adw.ButtonRow({ title: _('Grant access') });
  submit.add_css_class('suggested-action');
  add.add(capability);
  add.add(target);
  // A group of its own: a button row inside the form's list reads as one more field.
  const actions = new Adw.PreferencesGroup();
  actions.add(submit);
  page.add(actions);

  let rows: Gtk.Widget[] = [];
  let choices: TargetChoice[] = [];
  let preselected = false;

  const updateTargets = (): void => {
    try {
      choices = targetChoices(
        ctx.env.store.read(),
        ctx.env.lists(),
        GRANTABLE[capability.selected],
        ctx.env.boards(),
      );
    } catch {
      choices = [];
    }
    target.set_model(Gtk.StringList.new(choices.map((c) => c.label)));
    submit.set_sensitive(choices.length > 0);
    target.set_subtitle(choices.length > 0 ? '' : _('Nothing to choose from'));
  };
  capability.connect('notify::selected', updateTargets);

  submit.connect('activated', () => {
    const chosen = choices[target.selected];
    if (!chosen) return;
    void addGrant(ctx.env, GRANTABLE[capability.selected], chosen.target).then((outcome) => {
      if (!outcome.ok) ctx.toast(outcome.message);
      ctx.reload();
    });
  });

  const refresh = (): void => {
    for (const row of rows) granted.remove(row);
    rows = [];
    try {
      const config = ctx.env.store.read();
      const list = grantRows(config, ctx.env.lists(), ctx.env.boards());
      if (list.length === 0) {
        const none = new Adw.ActionRow({
          title: _('Nothing is granted'),
          subtitle: _('Agents cannot change anything.'),
        });
        granted.add(none);
        rows.push(none);
      }
      for (const grant of list) {
        const row = new Adw.ActionRow({
          title: grant.name,
          useMarkup: false,
          subtitle: capabilityLabel(grant.capability),
          titleLines: 1,
        });
        const button = Gtk.Button.new_from_icon_name('user-trash-symbolic');
        button.add_css_class('flat');
        button.set_valign(Gtk.Align.CENTER);
        button.set_tooltip_text(_('Revoke'));
        button.update_property([Gtk.AccessibleProperty.LABEL], [_('Revoke')]);
        button.connect('clicked', () => {
          button.set_sensitive(false);
          void removeGrant(ctx.env, grant.capability, grant.target).then((outcome) => {
            if (!outcome.ok) ctx.toast(outcome.message);
            ctx.reload();
          });
        });
        row.add_suffix(button);
        granted.add(row);
        rows.push(row);
      }
    } catch (err) {
      const row = new Adw.ActionRow({
        title: _('The configuration cannot be read'),
        subtitle: errorMessage(err),
        useMarkup: false,
      });
      granted.add(row);
      rows.push(row);
    }
    // Open on a capability that has somewhere to go, not on one whose target list is empty.
    if (!preselected) {
      preselected = true;
      try {
        const config = ctx.env.store.read();
        const first = GRANTABLE.findIndex(
          (c) => targetChoices(config, ctx.env.lists(), c, ctx.env.boards()).length > 0,
        );
        if (first > 0) capability.set_selected(first);
      } catch {
        // The error row above already says the configuration cannot be read.
      }
    }
    updateTargets();
  };
  return { page, refresh };
}
