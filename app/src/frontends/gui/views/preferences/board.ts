/** The board page: which sources show, whose cards, where each column goes, and external sources. */

import Adw from '@girs/adw-1';
import Gtk from '@girs/gtk-4.0';

import { _, errorMessage, MINE_FILTERS, type MineFilter, type SourceColumn } from '@reminder/core';

import type { BoardBinding } from '../../board-sync.ts';
import {
  boardSourceRows,
  columnRows,
  laneChoices,
  laneLabel,
  mineLabel,
  setColumnLane,
  setGlobalMine,
  setMineFor,
  setSourceDisabled,
  setSourceHidden,
  type BoardSourceRow,
} from './board-controller.ts';
import { createBoardSourceForm } from './board-source-form.ts';
import type { Outcome } from './controller.ts';
import type { PageContext, PrefsPage } from './page-context.ts';

const FOLLOW = 0;

export function createBoardPage(ctx: PageContext): PrefsPage {
  const page = new Adw.PreferencesPage({
    name: 'board',
    title: _('Board'),
    iconName: 'view-columns-symbolic',
  });
  const cards = new Adw.PreferencesGroup({
    title: _('Cards'),
    description: _('Which cards a board shows. A source can choose differently below.'),
  });
  const sources = new Adw.PreferencesGroup({ title: _('Sources') });
  const add = new Adw.PreferencesGroup();
  page.add(cards);
  page.add(sources);
  page.add(add);

  const run = (task: Promise<Outcome>, after?: () => void): void => {
    void task.then((outcome) => {
      if (!outcome.ok) ctx.toast(outcome.message);
      after?.();
      ctx.reload();
    });
  };

  let painting = false;
  const mineModel = (withFollow: boolean): Gtk.StringList =>
    Gtk.StringList.new([...(withFollow ? [_('Same as everywhere')] : []), ...MINE_FILTERS.map(mineLabel)]);

  const global = new Adw.ComboRow({ title: _('Show cards that are'), model: mineModel(false) });
  global.connect('notify::selected', () => {
    const value = MINE_FILTERS[global.selected];
    if (painting || value === undefined) return;
    run(setGlobalMine(ctx.env, value));
  });
  cards.add(global);

  const addRow = new Adw.ActionRow({
    title: _('Add board source'),
    subtitle: ctx.demo ? _('Not available in demo mode') : _('Nextcloud Deck, OpenProject or Zenkit'),
    activatable: true,
    sensitive: !ctx.demo,
  });
  addRow.add_prefix(Gtk.Image.new_from_icon_name('list-add-symbolic'));
  addRow.connect('activated', () => ctx.dialog.push_subpage(createBoardSourceForm(ctx, null)));
  add.add(addRow);

  let rows: Gtk.Widget[] = [];

  const boardRow = (row: BoardSourceRow, binding: BoardBinding): Adw.ExpanderRow => {
    const expander = new Adw.ExpanderRow({ title: binding.board.title || binding.board.id });
    const children: Gtk.Widget[] = [];
    let loaded = false;
    expander.connect('notify::expanded', () => {
      if (!expander.expanded || loaded) return;
      loaded = true;
      void binding.entry.source
        .listColumns(binding.board)
        .then((columns) => paint(columns))
        .catch((err) => {
          loaded = false;
          ctx.toast(errorMessage(err));
        });
    });
    const paint = (columns: SourceColumn[]): void => {
      for (const child of children) expander.remove(child);
      children.length = 0;
      const config = ctx.env.store.read();
      for (const column of columnRows(config, row.type, binding.board, columns)) {
        const source = columns.find((c) => c.name === column.name);
        if (!source) continue;
        const lanes = laneChoices(column.lane);
        const combo = new Adw.ComboRow({
          title: column.name,
          subtitle: column.custom ? undefined : _('Default'),
          model: Gtk.StringList.new(lanes.map(laneLabel)),
        });
        combo.set_selected(lanes.indexOf(column.lane));
        combo.connect('notify::selected', () => {
          const lane = lanes[combo.selected];
          if (lane === undefined || lane === column.lane) return;
          run(setColumnLane(ctx.env, row.type, binding.board, source, lane));
        });
        expander.add_row(combo);
        children.push(combo);
      }
    };
    return expander;
  };

  const sourceRow = (row: BoardSourceRow, bindings: readonly BoardBinding[]): Adw.ExpanderRow => {
    const expander = new Adw.ExpanderRow({
      title: row.id,
      subtitle: row.problem ?? row.detail,
      subtitleLines: 2,
    });
    expander.add_prefix(
      Gtk.Image.new_from_icon_name(row.problem ? 'dialog-warning-symbolic' : 'view-list-symbolic'),
    );
    if (row.enabled) {
      const show = new Adw.SwitchRow({ title: _('Show on the board'), active: !row.hidden });
      show.connect('notify::active', () => {
        if (painting || show.active === !row.hidden) return;
        run(setSourceHidden(ctx.env, row.id, !show.active));
      });
      expander.add_row(show);

      const mine = new Adw.ComboRow({ title: _('Show cards that are'), model: mineModel(true) });
      mine.set_selected(row.mine === null ? FOLLOW : MINE_FILTERS.indexOf(row.mine) + 1);
      mine.connect('notify::selected', () => {
        const value: MineFilter | null = mine.selected === FOLLOW ? null : MINE_FILTERS[mine.selected - 1];
        if (painting || value === undefined || value === row.mine) return;
        run(setMineFor(ctx.env, row.id, value));
      });
      expander.add_row(mine);
    }
    if (row.external) {
      const enabled = new Adw.SwitchRow({
        title: _('Enabled'),
        subtitle: _('Off: the source is not contacted and nothing of it is kept.'),
        active: row.enabled,
        sensitive: !ctx.demo,
      });
      enabled.connect('notify::active', () => {
        if (painting || enabled.active === row.enabled) return;
        run(setSourceDisabled(ctx.env, row.id, !enabled.active));
      });
      expander.add_row(enabled);
      const edit = new Adw.ActionRow({
        title: _('Edit address and credential'),
        activatable: true,
        sensitive: !ctx.demo,
      });
      edit.add_suffix(Gtk.Image.new_from_icon_name('go-next-symbolic'));
      edit.connect('activated', () => ctx.dialog.push_subpage(createBoardSourceForm(ctx, row.id)));
      expander.add_row(edit);
    }
    for (const binding of bindings) expander.add_row(boardRow(row, binding));
    return expander;
  };

  const refresh = (): void => {
    painting = true;
    for (const row of rows) sources.remove(row);
    rows = [];
    try {
      const config = ctx.env.store.read();
      global.set_selected(MINE_FILTERS.indexOf(config.boards.mine));
      const bindings = ctx.env.boards();
      const list = boardSourceRows(config, bindings, ctx.env.settings.hidden(), ctx.env.boardProblems());
      if (list.length === 0) {
        const none = new Adw.ActionRow({ title: _('No board sources yet') });
        sources.add(none);
        rows.push(none);
      }
      for (const row of list) {
        const widget = sourceRow(
          row,
          bindings.filter((b) => b.entry.info.id === row.id),
        );
        sources.add(widget);
        rows.push(widget);
      }
    } catch (err) {
      const row = new Adw.ActionRow({
        title: _('The configuration cannot be read'),
        subtitle: errorMessage(err),
      });
      sources.add(row);
      rows.push(row);
    }
    painting = false;
  };
  return { page, refresh };
}
