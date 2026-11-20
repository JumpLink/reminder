// Test entry: aggregates every *.test.ts suite (each a default-exported async fn) and runs them
// under @gjsify/unit, on GJS and Node both (`gjsify test`). Keep this list in sync when adding a
// test file — an unlisted suite never runs, and that looks exactly like a passing one.
import { run } from '@gjsify/unit';

import ical from './unit/core/ical.test.ts';
import grants from './unit/core/grants.test.ts';
import routing from './unit/core/routing.test.ts';
import sourceKey from './unit/core/source-key.test.ts';
import dates from './unit/core/dates.test.ts';
import config from './unit/core/config.test.ts';
import configWrite from './unit/core/config-write.test.ts';
import accounts from './unit/accounts.test.ts';
import read from './unit/core/read.test.ts';
import create from './unit/core/create.test.ts';
import update from './unit/core/update.test.ts';
import priorities from './unit/core/priorities.test.ts';
import cache from './unit/core/cache.test.ts';
import sync from './unit/core/sync.test.ts';
import visibility from './unit/core/visibility.test.ts';
import agenda from './unit/core/agenda.test.ts';
import expandEvents from './unit/core/expand-events.test.ts';
import board from './unit/board/board.test.ts';
import boardRules from './unit/board/rules.test.ts';
import boardMine from './unit/board/mine.test.ts';
import boardVtodo from './unit/board/vtodo-source.test.ts';
import boardConfig from './unit/board/config.test.ts';
import zenkit from './unit/zenkit/zenkit-source.test.ts';
import boardOpenProject from './unit/openproject/openproject-source.test.ts';
import boardSources from './unit/board/board-sources.test.ts';
import boardExternalSources from './unit/board/external-sources.test.ts';
import boardDemoSource from './unit/board/demo-source.test.ts';
import boardRead from './unit/board/board-read.test.ts';
import boardCache from './unit/core/board-cache.test.ts';
import secrets from './unit/secrets/secrets.test.ts';
import cacheFs from './unit/cache/cache-fs.test.ts';

import caldav from './unit/caldav/caldav.test.ts';
import caldavDelta from './unit/caldav/delta.test.ts';
import eds from './unit/eds/optional.test.ts';

import httpClient from './unit/http/http-client.test.ts';
import deck from './unit/deck/deck-source.test.ts';
import recurrence from './unit/recurrence/expand.test.ts';

import dueState from './unit/widgets/due-state.test.ts';
import sourceNames from './unit/widgets/source-names.test.ts';
import priorityMarks from './unit/widgets/priority-marks.test.ts';
import swipeRules from './unit/widgets/swipe-rules.test.ts';
import adaptiveContainer from './unit/widgets/adaptive-container.test.ts';
import boardLayout from './unit/widgets/board-rules.test.ts';
import calendarFormat from './unit/widgets/calendar-format.test.ts';
import monthRules from './unit/widgets/month-rules.test.ts';
import timeGridRules from './unit/widgets/time-grid-rules.test.ts';
import agendaRules from './unit/widgets/agenda-rules.test.ts';

import calendarLayout from './unit/calendar-layout/calendar-layout.test.ts';

import sizeClasses from './unit/gui/size-classes.test.ts';
import guiViewModel from './unit/gui/view-model.test.ts';
import guiCalendarViewModel from './unit/gui/calendar-view-model.test.ts';
import guiCalendarModel from './unit/gui/calendar-model.test.ts';
import guiSettings from './unit/gui/settings.test.ts';
import guiModel from './unit/gui/model.test.ts';
import guiBoardViewModel from './unit/gui/board-view-model.test.ts';
import guiBoardModel from './unit/gui/board-model.test.ts';
import guiSync from './unit/gui/sync.test.ts';
import guiDemo from './unit/gui/demo.test.ts';
import guiPreferences from './unit/gui/preferences.test.ts';
import guiPreferencesBoard from './unit/gui/preferences-board.test.ts';

import mcpTools from './unit/mcp/tools.test.ts';

import i18n from './unit/i18n/i18n.test.ts';

run({
  ical,
  grants,
  routing,
  sourceKey,
  dates,
  config,
  configWrite,
  accounts,
  read,
  create,
  update,
  priorities,
  cache,
  sync,
  visibility,
  agenda,
  expandEvents,
  board,
  boardRules,
  boardMine,
  boardVtodo,
  boardConfig,
  zenkit,
  boardOpenProject,
  boardSources,
  boardExternalSources,
  boardDemoSource,
  boardRead,
  boardCache,
  secrets,
  cacheFs,
  caldav,
  caldavDelta,
  eds,
  httpClient,
  deck,
  recurrence,
  dueState,
  sourceNames,
  priorityMarks,
  swipeRules,
  adaptiveContainer,
  boardLayout,
  calendarFormat,
  monthRules,
  timeGridRules,
  agendaRules,
  calendarLayout,
  sizeClasses,
  guiViewModel,
  guiCalendarViewModel,
  guiCalendarModel,
  guiSettings,
  guiModel,
  guiBoardViewModel,
  guiBoardModel,
  guiSync,
  guiDemo,
  guiPreferences,
  guiPreferencesBoard,
  mcpTools,
  i18n,
});
