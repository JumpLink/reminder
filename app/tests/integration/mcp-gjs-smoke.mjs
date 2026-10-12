// Smoke test: the reminder MCP stdio server runs on GJS, answers `initialize` + `tools/list` +
// `tools/call` from the MCP SDK client, and EXITS when its client goes away.
//
// Launched via `gjsify run` with a clean env (no LD_LIBRARY_PATH / GI_TYPELIB_PATH), so a green
// run proves no launcher wrapper is needed. Works without an EDS session: `calendars_list` then
// answers with an error RESULT, which is the contract — not a crash, not an empty list.
//
// Prerequisite: `gjsify install` + `gjsify workspace reminder-cli build`, and gjs on PATH.
// Run with: `node app/tests/integration/mcp-gjs-smoke.mjs`.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..', '..');
const repoRoot = join(appRoot, '..');
const bundle = join(appRoot, 'dist', 'reminder.gjs.mjs');
assert(existsSync(bundle), 'build first — app/dist/reminder.gjs.mjs missing');

const gjsify = join(repoRoot, 'node_modules', '.bin', 'gjsify');
assert(existsSync(gjsify), 'run `gjsify install` first — @gjsify/cli bin missing');

const baseEnv = { ...process.env };
delete baseEnv.LD_LIBRARY_PATH;
delete baseEnv.GI_TYPELIB_PATH;
// Never let a developer's real config take part in a test run.
const env = {
  ...baseEnv,
  REMINDER_CONFIG: join(repoRoot, 'node_modules', '.cache', 'reminder-smoke-config.json'),
};

const READ_ONLY_TOOLS = ['calendars_list', 'events_list', 'priorities_list', 'reminders_list'];

// ── 1. catalogue: read-only, asserted on the wire ───────────────────────────

const transport = new StdioClientTransport({
  command: gjsify,
  args: ['run', bundle, 'mcp'],
  env,
  cwd: appRoot,
  stderr: 'inherit',
});
const client = new Client({ name: 'gjs-smoke', version: '1.0.0' }, { capabilities: {} });
await client.connect(transport);
const info = client.getServerVersion();
assert.equal(info?.name, 'reminder', `unexpected server name: ${info?.name}`);

const { tools } = await client.listTools();
assert.deepEqual(
  tools.map((t) => t.name).sort(),
  READ_ONLY_TOOLS,
  'tool catalogue drifted — update READ_ONLY_TOOLS deliberately, it is the client contract',
);
for (const tool of tools) {
  assert.equal(tool.annotations?.readOnlyHint, true, `tool ${tool.name} is not marked read-only`);
}
console.log(`OK: MCP stdio server on GJS — ${tools.length} read-only tools (${info.name} ${info.version})`);

// ── 2. a real call: an answer either way, and only counts are printed ───────

const res = await client.callTool({ name: 'calendars_list', arguments: {} });
assert(Array.isArray(res.content) && res.content.length > 0, 'calendars_list returned no content');
const text = String(res.content[0].text);
if (res.isError) {
  assert(text.length > 2 && text !== '{}', `error result carries no message: ${text}`);
  console.log('OK: calendars_list → error result (no EDS session here)');
} else {
  const payload = JSON.parse(text);
  assert(typeof payload.count === 'number', 'expected a count');
  console.log(`OK: calendars_list → ${payload.count} calendars`);
}
await client.close();

// ── 3. the server exits when its client goes away ───────────────────────────
//
// Raw spawn on purpose: StdioClientTransport.close() KILLS the child, which would pass whether or
// not EOF is handled. An unhandled EOF leaves an orphan reparented to `systemd --user`.

const child = spawn(gjsify, ['run', bundle, 'mcp'], {
  env,
  cwd: appRoot,
  stdio: ['pipe', 'pipe', 'inherit'],
});
const exitedEarly = await Promise.race([
  new Promise((r) => child.once('exit', (code) => r(`exited early with ${code}`))),
  new Promise((r) => setTimeout(() => r(null), 4000)),
]);
assert.equal(exitedEarly, null, `server did not stay up while stdin was open: ${exitedEarly}`);

child.stdin.end();
const outcome = await Promise.race([
  new Promise((r) => child.once('exit', (code) => r(code))),
  new Promise((r) => setTimeout(() => r('timeout'), 15000)),
]);
if (outcome === 'timeout') {
  child.kill('SIGKILL');
  assert.fail('server did not exit within 15s of stdin EOF — it would be orphaned');
}
assert.equal(outcome, 0, `server exited with ${outcome} on stdin EOF, expected 0`);
console.log('OK: server exits cleanly on stdin EOF (no orphan)');

process.exit(0);
