/**
 * The main window: a view switcher over three pages (tasks is real, the others still placeholders),
 * wrapped by the sources overview. Content is built once; the
 * breakpoint ladder only changes the container around it (ADR 0012) — the switcher sits in a bar
 * at the bottom while compact and in the header from medium up.
 */

import Adw from '@girs/adw-1';
import Gio from '@girs/gio-2.0';
import GObject from '@girs/gobject-2.0';
import Gtk from '@girs/gtk-4.0';
import { createSwitcherShell } from '@gjsify/adwaita-app';

import { _, type SyncService } from '@reminder/core';

import { demoNotice } from '../../core/demo/index.ts';

import {
  APP_NAME,
  BREAKPOINT_CONDITIONS,
  COMPACT_MAX_SP,
  SIZE_CLASSES,
  type SizeClass,
  VIEW_NAMES,
  type ViewName,
} from './constants.ts';
import type { GuiSettings } from './settings.ts';
import type { TasksModel } from './model.ts';
import { createOverview, type Overview } from './views/overview.ts';
import { createTasksView, type TasksView } from './views/tasks.ts';
import Template, { type Children, GTypeName, InternalChildren } from './window.blp';

// oxlint-disable-next-line no-unsafe-declaration-merging -- GJS installs the internal children
export interface MainWindow extends Children {}

function placeholder(title: string, description: string, icon: string): Adw.StatusPage {
  return new Adw.StatusPage({ title, description, iconName: icon, vexpand: true });
}

/** What the window needs once its services are up; they start after the window is on screen. */
export interface WindowServices {
  model: TasksModel;
  settings: GuiSettings;
  service: SyncService;
  problems: readonly string[];
}

export class MainWindow extends Adw.ApplicationWindow {
  static {
    GObject.registerClass({ GTypeName, Template, InternalChildren }, this);
  }

  private readonly stack: Adw.ViewStack;
  private sizeClass: SizeClass = 'medium';
  private readonly toasts = new Adw.ToastOverlay();
  private readonly tasks: TasksView;
  private readonly overview: Overview;
  private model: TasksModel | null = null;
  private settings: GuiSettings | null = null;
  private hidden: ReadonlySet<string> = new Set();

  constructor(app: Adw.Application, hooks: { view?: string; size?: [number, number]; demo?: boolean } = {}) {
    super({ application: app, title: APP_NAME });
    if (hooks.size) this.set_default_size(hooks.size[0], hooks.size[1]);

    const views: Record<ViewName, { title: string; description: string; icon: string }> = {
      calendar: {
        title: _('Calendar'),
        description: _('Events from your calendars will appear here.'),
        icon: 'x-office-calendar-symbolic',
      },
      tasks: {
        title: _('Tasks'),
        description: _('Your reminders will appear here.'),
        icon: 'object-select-symbolic',
      },
      board: {
        title: _('Board'),
        description: _('Your reminders as cards will appear here.'),
        icon: 'view-grid-symbolic',
      },
    };

    this.tasks = createTasksView((message) => this.toasts.add_toast(new Adw.Toast({ title: message })));

    const shell = createSwitcherShell(this, {
      narrowWidth: COMPACT_MAX_SP,
      pages: VIEW_NAMES.map((name) => ({
        name,
        title: views[name].title,
        icon: views[name].icon,
        widget:
          name === 'tasks'
            ? this.tasks.widget
            : placeholder(views[name].title, views[name].description, views[name].icon),
      })),
    });
    this.stack = shell.stack;
    if (hooks.demo) {
      shell.toolbarView.add_top_bar(new Adw.Banner({ title: demoNotice(), revealed: true }));
    }
    this.toasts.set_child(shell.widget);
    this.overview = createOverview(this.toasts, (target, visible) => this.setSourceVisible(target, visible));
    this._host.set_child(this.overview.widget);
    shell.headerBar.pack_start(this.overview.button);
    shell.headerBar.pack_end(this.buildMenuButton());

    this.installSizeClasses(shell.breakpoint);
    this.installActions(views);
    if (hooks.view && (VIEW_NAMES as readonly string[]).includes(hooks.view)) {
      this.stack.set_visible_child_name(hooks.view);
    }
  }

  private buildMenuButton(): Gtk.MenuButton {
    const menu = new Gio.Menu();
    menu.append(_('Keyboard Shortcuts'), 'win.shortcuts');
    menu.append(_('About reminder'), 'app.about');
    const label = _('Main Menu');
    const button = new Gtk.MenuButton({
      iconName: 'open-menu-symbolic',
      menuModel: menu,
      primary: true,
      tooltipText: label,
    });
    button.update_property([Gtk.AccessibleProperty.LABEL], [label]);
    return button;
  }

  /**
   * One breakpoint per rung. Adw keeps exactly ONE breakpoint applied, so a rung must carry all of
   * its own setters: the shell's breakpoint is the compact rung (bottom bar in, header switcher
   * out) and the other two rungs need no setters because the shell's defaults are theirs.
   */
  private installSizeClasses(compact: Adw.Breakpoint): void {
    compact.connect('apply', () => this.setSizeClass('compact'));
    for (const sizeClass of SIZE_CLASSES) {
      if (sizeClass === 'compact') continue;
      const breakpoint = Adw.Breakpoint.new(Adw.BreakpointCondition.parse(BREAKPOINT_CONDITIONS[sizeClass]));
      breakpoint.connect('apply', () => this.setSizeClass(sizeClass));
      this.add_breakpoint(breakpoint);
    }
    this.add_css_class(`size-${this.sizeClass}`);
  }

  private setSizeClass(next: SizeClass): void {
    for (const sizeClass of SIZE_CLASSES) this.remove_css_class(`size-${sizeClass}`);
    this.add_css_class(`size-${next}`);
    this.sizeClass = next;
    this.overview.setSizeClass(next);
    this.tasks.setSizeClass(next);
  }

  /** Called once the config is read and the sync service built; until then the views are empty. */
  attach({ model, settings, service, problems }: WindowServices): void {
    this.model = model;
    this.settings = settings;
    this.hidden = settings.hidden();
    this.tasks.setModel(model, this.hidden);
    model.subscribe(() => {
      this.overview.setSources(model.calendars(), this.hidden);
      this.overview.setBanner(this.tasks.syncProblems());
    });
    this.connect('close-request', () => {
      service.stop();
      return false;
    });
    this.connect('notify::is-active', () => {
      if (this.isActive) model.focus();
    });
    if (problems.length > 0) this.toasts.add_toast(new Adw.Toast({ title: problems.join(' · ') }));
  }

  /** A start-up failure (unreadable config …): say so where the tasks would be. */
  showError(message: string): void {
    this.tasks.setError(message);
  }

  private setSourceVisible(target: string, visible: boolean): void {
    if (!this.settings) return;
    this.hidden = this.settings.setHidden(target, !visible);
    this.tasks.setHidden(this.hidden);
  }

  private installActions(views: Record<ViewName, { title: string }>): void {
    const app = this.get_application();
    VIEW_NAMES.forEach((name, index) => {
      const action = new Gio.SimpleAction({ name: `view-${name}` });
      action.connect('activate', () => this.stack.set_visible_child_name(name));
      this.add_action(action);
      app?.set_accels_for_action(`win.view-${name}`, [`<primary>${index + 1}`]);
    });
    const refresh = new Gio.SimpleAction({ name: 'refresh' });
    refresh.connect('activate', () => this.model?.refresh());
    this.add_action(refresh);
    app?.set_accels_for_action('win.refresh', ['<primary>r', 'F5']);
    const shortcuts = new Gio.SimpleAction({ name: 'shortcuts' });
    shortcuts.connect('activate', () => this.showShortcuts(views));
    this.add_action(shortcuts);
    app?.set_accels_for_action('win.shortcuts', ['<primary>question']);
  }

  private showShortcuts(views: Record<ViewName, { title: string }>): void {
    const section = new Adw.ShortcutsSection();
    section.title = _('General');
    for (const name of VIEW_NAMES) {
      section.add(Adw.ShortcutsItem.new_from_action(views[name].title, `win.view-${name}`));
    }
    section.add(Adw.ShortcutsItem.new_from_action(_('Refresh'), 'win.refresh'));
    section.add(Adw.ShortcutsItem.new_from_action(_('Keyboard Shortcuts'), 'win.shortcuts'));
    section.add(Adw.ShortcutsItem.new_from_action(_('Quit'), 'app.quit'));
    const dialog = new Adw.ShortcutsDialog();
    dialog.add(section);
    dialog.present(this);
  }
}
