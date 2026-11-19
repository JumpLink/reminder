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
import board from './unit/board/board.test.ts';
import boardRules from './unit/board/rules.test.ts';
import boardMine from './unit/board/mine.test.ts';
import boardVtodo from './unit/board/vtodo-source.test.ts';
import secrets from './unit/secrets/secrets.test.ts';
import cacheFs from './unit/cache/cache-fs.test.ts';

import caldav from './unit/caldav/caldav.test.ts';
import caldavDelta from './unit/caldav/delta.test.ts';
import eds from './unit/eds/optional.test.ts';

import httpClient from './unit/http/http-client.test.ts';

import dueState from './unit/widgets/due-state.test.ts';
import sourceNames from './unit/widgets/source-names.test.ts';
import priorityMarks from './unit/widgets/priority-marks.test.ts';
import swipeRules from './unit/widgets/swipe-rules.test.ts';
import adaptiveContainer from './unit/widgets/adaptive-container.test.ts';
import boardLayout from './unit/widgets/board-rules.test.ts';

import sizeClasses from './unit/gui/size-classes.test.ts';
import guiViewModel from './unit/gui/view-model.test.ts';
import guiSettings from './unit/gui/settings.test.ts';
import guiModel from './unit/gui/model.test.ts';
import guiSync from './unit/gui/sync.test.ts';
import guiDemo from './unit/gui/demo.test.ts';
import guiPreferences from './unit/gui/preferences.test.ts';

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
  board,
  boardRules,
  boardMine,
  boardVtodo,
  secrets,
  cacheFs,
  caldav,
  caldavDelta,
  eds,
  httpClient,
  dueState,
  sourceNames,
  priorityMarks,
  swipeRules,
  adaptiveContainer,
  boardLayout,
  sizeClasses,
  guiViewModel,
  guiSettings,
  guiModel,
  guiSync,
  guiDemo,
  guiPreferences,
  mcpTools,
  i18n,
});
