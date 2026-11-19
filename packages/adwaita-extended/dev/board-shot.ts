// Renders one KanbanBoard in a window of a fixed width, for screenshots (run under headless-run).
// Build: gjsify build dev/board-shot.ts --app gjs --outfile dist/board-shot.gjs.mjs
import Adw from '@girs/adw-1';
import GLib from '@girs/glib-2.0';
import system from 'system';

import { KanbanBoard } from '../src/kanban-board.ts';
import { sampleColumns } from '../src/kanban-board.story.ts';
import type { SizeClass } from '../src/size-class.ts';

const width = Number(GLib.getenv('BOARD_SHOT_WIDTH') ?? '800');
const height = Number(GLib.getenv('BOARD_SHOT_HEIGHT') ?? '640');
const sizeClass: SizeClass = width < 600 ? 'compact' : width < 1024 ? 'medium' : 'wide';

const app = new Adw.Application({ applicationId: 'org.gjsify.AdwaitaExtended.BoardShot' });
app.connect('activate', () => {
  const board = new KanbanBoard();
  board.setSizeClass(sizeClass);
  board.setColumns(sampleColumns());
  const view = new Adw.ToolbarView();
  view.add_top_bar(new Adw.HeaderBar());
  view.set_content(board);
  const win = new Adw.ApplicationWindow({ application: app, defaultWidth: width, defaultHeight: height, content: view });
  win.present();
});
app.run([system.programInvocationName]);
