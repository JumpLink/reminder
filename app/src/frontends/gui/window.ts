/**
 * The main window: a view switcher over the calendar, the tasks and the board, wrapped by the
 * sources overview. Content is built once; the breakpoint ladder only changes the container around
 * it (ADR 0012) — the switcher sits in a bar at the bottom while compact and in the header from
 * medium up.
 */

import Adw from '@girs/adw-1';
import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
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
import type { BoardModel } from './board-model.ts';
import type { CalendarModel } from './calendar-model.ts';
import { CALENDAR_MODES, isCalendarMode } from './calendar-view-model.ts';
import type { TasksModel } from './model.ts';
import { createBoardView, type BoardView } from './views/board.ts';
import { createCalendarView, type CalendarView } from './views/calendar.ts';
import { createOverview, type Overview } from './views/overview.ts';
import { createTasksView, type TasksView } from './views/tasks.ts';
import Template, { type Children, GTypeName, InternalChildren } from './window.blp';

// oxlint-disable-next-line no-unsafe-declaration-merging -- GJS installs the internal children
export interface MainWindow extends Children {}

/** What the window needs once its services are up; they start after the window is on screen. */
export interface WindowServices {
  model: TasksModel;
  board: BoardModel;
  calendar: CalendarModel;
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
  private readonly board: BoardView;
  private readonly calendar: CalendarView;
  private readonly overview: Overview;
  private model: TasksModel | null = null;
  private settings: GuiSettings | null = null;
  private hidden: ReadonlySet<string> = new Set();
  private service: SyncService | null = null;
  private handlersConnected = false;
  private unsubscribe: (() => void) | null = null;
  /** Set by `main.ts`, which owns what the preferences need. */
  onPreferences: (() => void) | null = null;

  constructor(
    app: Adw.Application,
    hooks: { view?: string; size?: [number, number]; demo?: boolean; calendarMode?: string } = {},
  ) {
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

    // The optional button is what a conflict needs: the message, and the refresh that resolves it.
    const toast = (message: string, action?: { label: string; run(): void }): void => {
      const item = new Adw.Toast({ useMarkup: false, title: message });
      if (action) {
        item.set_button_label(action.label);
        item.connect('button-clicked', () => action.run());
      }
      this.toasts.add_toast(item);
    };
    this.tasks = createTasksView(toast);
    this.board = createBoardView(toast);
    this.calendar = createCalendarView(toast);
    if (hooks.calendarMode && isCalendarMode(hooks.calendarMode)) this.calendar.setMode(hooks.calendarMode);

    const pageWidget = (name: ViewName): Gtk.Widget => {
      if (name === 'tasks') return this.tasks.widget;
      if (name === 'board') return this.board.widget;
      return this.calendar.widget;
    };
    const shell = createSwitcherShell(this, {
      narrowWidth: COMPACT_MAX_SP,
      pages: VIEW_NAMES.map((name) => ({
        name,
        title: views[name].title,
        icon: views[name].icon,
        widget: pageWidget(name),
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
    menu.append(_('Preferences'), 'win.preferences');
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
    this.board.setSizeClass(next);
    this.calendar.setSizeClass(next);
  }

  /**
   * Called when the config is read and the sync service built, and again after every rebuild the
   * preferences ask for: the previous model's subscription ends and its service has been stopped.
   */
  attach({ model, board, calendar, settings, service, problems }: WindowServices): void {
    this.unsubscribe?.();
    this.model = model;
    this.settings = settings;
    this.service = service;
    this.hidden = settings.hidden();
    this.tasks.setModel(model, this.hidden);
    this.board.setModel(board);
    this.calendar.setModel(calendar, settings, this.hidden);
    this.unsubscribe = model.subscribe(() => {
      this.overview.setSources(model.calendars(), this.hidden);
      this.overview.setBanner(this.tasks.syncProblems());
    });
    if (!this.handlersConnected) {
      this.handlersConnected = true;
      this.connect('close-request', () => {
        this.service?.stop();
        return false;
      });
      this.connect('notify::is-active', () => {
        if (this.isActive) this.model?.focus();
      });
    }
    if (problems.length > 0)
      this.toasts.add_toast(new Adw.Toast({ useMarkup: false, title: problems.join(' · ') }));
  }

  /** After a settings change the calendar depends on (week start, week numbers). */
  relayoutCalendar(): void {
    this.calendar.reload();
  }

  /** A start-up failure (unreadable config …): say so where the tasks and the cards would be. */
  showError(message: string): void {
    this.tasks.setError(message);
    this.board.setError(message);
    this.calendar.setError(message);
  }

  /** `REMINDER_APP_CARD=1`: the board's first card detail, so a screenshot shows the pane. */
  openFirstCard(): boolean {
    return this.board.openFirstCard();
  }

  private setSourceVisible(target: string, visible: boolean): void {
    if (!this.settings) return;
    this.hidden = this.settings.setHidden(target, !visible);
    this.tasks.setHidden(this.hidden);
    this.calendar.setHidden(this.hidden);
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
    refresh.connect('activate', () => {
      this.model?.refresh();
      this.calendar.reload();
    });
    this.add_action(refresh);
    app?.set_accels_for_action('win.refresh', ['<primary>r', 'F5']);
    this.installCalendarActions(app);
    const preferences = new Gio.SimpleAction({ name: 'preferences' });
    preferences.connect('activate', () => this.onPreferences?.());
    this.add_action(preferences);
    app?.set_accels_for_action('win.preferences', ['<primary>comma']);
    const shortcuts = new Gio.SimpleAction({ name: 'shortcuts' });
    shortcuts.connect('activate', () => this.showShortcuts(views));
    this.add_action(shortcuts);
    app?.set_accels_for_action('win.shortcuts', ['<primary>question']);
  }

  /**
   * Moving around the calendar from the keyboard. `<alt>Left/Right` is what a page of anything
   * steps with in GNOME; `<primary>Page_Up/Page_Down` is the same step for anyone whose Alt arrows
   * belong to the window manager. The mode takes `<primary><shift>`, because `<primary>1..3`
   * already switches the three views.
   */
  private installCalendarActions(app: Gtk.Application | null): void {
    const previous = new Gio.SimpleAction({ name: 'calendar-previous' });
    previous.connect('activate', () => this.calendar.step(-1));
    this.add_action(previous);
    app?.set_accels_for_action('win.calendar-previous', ['<alt>Left', '<primary>Page_Up']);

    const next = new Gio.SimpleAction({ name: 'calendar-next' });
    next.connect('activate', () => this.calendar.step(1));
    this.add_action(next);
    app?.set_accels_for_action('win.calendar-next', ['<alt>Right', '<primary>Page_Down']);

    const today = new Gio.SimpleAction({ name: 'calendar-today' });
    today.connect('activate', () => this.calendar.goToday());
    this.add_action(today);
    app?.set_accels_for_action('win.calendar-today', ['<primary>t']);

    const mode = Gio.SimpleAction.new_stateful(
      'calendar-mode',
      GLib.VariantType.new('s'),
      GLib.Variant.new_string('month'),
    );
    mode.connect('activate', (_self, parameter) => {
      const name = parameter?.get_string()[0];
      if (name !== undefined && isCalendarMode(name)) this.calendar.setMode(name);
    });
    this.add_action(mode);
    this.calendar.onModeChanged = (next) => mode.set_state(GLib.Variant.new_string(next));
    for (const name of CALENDAR_MODES) {
      app?.set_accels_for_action(`win.calendar-mode('${name}')`, [`<primary><shift>${name.charAt(0)}`]);
    }
  }

  private showShortcuts(views: Record<ViewName, { title: string }>): void {
    const section = new Adw.ShortcutsSection();
    section.title = _('General');
    for (const name of VIEW_NAMES) {
      section.add(Adw.ShortcutsItem.new_from_action(views[name].title, `win.view-${name}`));
    }
    section.add(Adw.ShortcutsItem.new_from_action(_('Refresh'), 'win.refresh'));
    section.add(Adw.ShortcutsItem.new_from_action(_('Preferences'), 'win.preferences'));
    section.add(Adw.ShortcutsItem.new_from_action(_('Keyboard Shortcuts'), 'win.shortcuts'));
    section.add(Adw.ShortcutsItem.new_from_action(_('Quit'), 'app.quit'));

    const calendar = new Adw.ShortcutsSection();
    calendar.title = _('Calendar');
    calendar.add(Adw.ShortcutsItem.new_from_action(_('Previous'), 'win.calendar-previous'));
    calendar.add(Adw.ShortcutsItem.new_from_action(_('Next'), 'win.calendar-next'));
    calendar.add(Adw.ShortcutsItem.new_from_action(_('Today'), 'win.calendar-today'));
    calendar.add(Adw.ShortcutsItem.new_from_action(_('Month'), "win.calendar-mode('month')"));
    calendar.add(Adw.ShortcutsItem.new_from_action(_('Week'), "win.calendar-mode('week')"));
    calendar.add(Adw.ShortcutsItem.new_from_action(_('Day'), "win.calendar-mode('day')"));

    const dialog = new Adw.ShortcutsDialog();
    dialog.add(section);
    dialog.add(calendar);
    dialog.present(this);
  }
}
