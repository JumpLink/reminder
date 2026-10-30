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
import read from './unit/core/read.test.ts';
import create from './unit/core/create.test.ts';
import update from './unit/core/update.test.ts';
import priorities from './unit/core/priorities.test.ts';

import caldav from './unit/caldav/caldav.test.ts';
import eds from './unit/eds/optional.test.ts';

import mcpTools from './unit/mcp/tools.test.ts';

import i18n from './unit/i18n/i18n.test.ts';

run({
  ical,
  grants,
  routing,
  sourceKey,
  dates,
  config,
  read,
  create,
  update,
  priorities,
  caldav,
  eds,
  mcpTools,
  i18n,
});
