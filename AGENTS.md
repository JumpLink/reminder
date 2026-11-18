# AGENTS.md — reminder

Operating guide for AI agents in the **reminder** repo. Follows the [agents.md](https://agents.md/)
convention; human overview in [README.md](README.md). **This file is a router:** what an agent
needs before opening anything stays here; the reasoning lives in [docs/](docs/README.md).

## What this is

Calendar events (VEVENT) and reminders (VTODO) as a CLI and an MCP server, on GJS via gjsify. A
TypeScript monorepo: pure `packages/*` plus one `app` workspace that carries the gjsify toolchain
and picks a frontend at the yargs entrypoint. Scope, backends and grants:
[ADR 0001](docs/adr/0001-calendar-items-as-their-own-product.md); changing a reminder that already
exists: [ADR 0003](docs/adr/0003-managing-reminders-in-place.md).

## Hard rules

| Rule | Why |
|---|---|
| **Public repo: no personal data** | No real calendar uids, addresses, names or events — in code, tests, fixtures, docs, commits. Placeholders (`<calendar-uid>`, `example.org`) only. The real config lives in `$XDG_CONFIG_HOME`, never here |
| **Writes need a grant, per capability and exact target** | Missing grant = refusal; wildcard/empty/unknown capability = `ConfigError` at load. The check lives inside `createEvent` / `createReminder` / `updateReminder`, never in a frontend |
| **MCP writes are gated twice, and a new one is an ADR** | `applyGrantGate` serves `events_create` / `reminders_create` / `reminders_update` only when the config grants their capability, and re-checks the exact target per call; the core checks again. A tool with no annotation is dropped, never served unguarded. Adding a write tool is a decision (ADR 0001 §4), not a registrar edit |
| **An update rewrites the lines it touches, nothing else** | `packages/core/src/rewrite.ts` edits the stored text line by line: every property the change set does not name survives byte-for-byte, including folding, `VALARM`, `RRULE`, `CATEGORIES` and `X-REMINDER-SOURCE`. Re-serialising a parsed task silently drops what the parser does not model. Every write bumps `SEQUENCE` and stamps `DTSTAMP` + `LAST-MODIFIED`. [ADR 0003](docs/adr/0003-managing-reminders-in-place.md) |
| **An update never overwrites a concurrent change** | CalDAV `updateItem` sends `If-Match` with the etag from its own read, so a 412 becomes `ConflictError` instead of a lost edit. A backend without etags (EDS) relies on the server's own conflict handling |
| **Dedupe by source key** | Every create takes `source` + `sourceId`; the key goes into `X-REMINDER-SOURCE` and decides the UID. A UID holding a different key is an error, never a merge |
| **The backend port moves iCalendar text only** | Parsing, dedupe, grants, routing stay in `@reminder/core`. A backend that parses is a second copy of the rules |
| **No raw native error crosses a backend** | Wrap as `BackendError` / `BackendUnavailableError` — a `GLib.Error` JSON-serialises to `{}` |
| **Never guess a time zone** | Unresolvable TZID stays floating; create input needs an offset, `Z`, or a bare date |

## Package layout

| Package | What | May import |
|---|---|---|
| `@gjsify/pim` | incubating ([ADR 0016](docs/adr/0016-gjsify-pim-incubates-here.md), MIT): the `CalendarBackend` port, its types and backend errors; drivers `@gjsify/pim/caldav` and `@gjsify/pim/eds` (typelibs load lazily) | `@gjsify/dav`, `gi://` in `*.gjs.ts` only — never `@reminder/*` |
| `@gjsify/adwaita-extended` | incubating (MIT, moves to gjsify unchanged): GTK4/libadwaita widgets with stories, own gettext domain `gjsify-adwaita-extended`; `DueChip` + pure `dueState` (`/due-state`, Node-safe). Stories: `gjsify workspace @gjsify/adwaita-extended stories`. Lint (`.oxlintrc.json` override) fails on `@reminder/*` and `@gjsify/pim` imports | `gi://`/`@girs/*`, GJS `gettext` — never `@reminder/*`, never `@gjsify/pim` |
| `@reminder/core` | types, errors, iCalendar, grants, routing, config model, read + create + update, sync service (`sync/`: states, schedule, back-off); re-exports the port from `@gjsify/pim` | the root of `@gjsify/pim` only (`types: []`) |
| `@reminder/cache-fs` | `CacheStore` driver: files under `$XDG_CACHE_HOME`, atomic writes ([ADR 0010](docs/adr/0010-cache-and-synchronisation.md)) | `@reminder/core`, `node:*` |
| `@reminder/secrets-libsecret` | `SecretStore` driver over `gi://Secret`, lazy; no service = unavailable ([ADR 0011](docs/adr/0011-credentials-through-a-secret-store-port.md)) | `@reminder/core`, `gi://` |
| `reminder-cli` (`app/`) | yargs CLI, MCP server, config file I/O, backend factory | everything |

A new backend is a new driver in `@gjsify/pim` implementing `CalendarBackend` plus a `backend`
value in `BACKENDS`; callers do not change.

## Conventions

- Files with a `gi://` import are named `*.gjs.ts`; EDS namespaces are imported **type-only** at top
  level and loaded through `optionalNamespace` (see `packages/pim/src/optional.ts`).
- No TS parameter properties (Node runs the sources with strip-types). No `any`.
- User-facing strings: English msgids through `_()`/`_n()` (gettext, German in `app/po/de.po`); see docs/i18n-status.md. MCP tool text and JSON output stay English. Sort with code-unit compare, not `localeCompare`.
- Result caps live in `packages/core/src/limits.ts` only; the CLI help and MCP schemas read them.
- Tests: every suite is a default-exported async fn listed in `app/tests/test.mts` — an unlisted
  suite never runs. EDS is tested behind `app/tests/unit/fake-backend.ts`; the live backend only for
  its degrade path. Use field comparisons: `@gjsify/unit`'s `toEqual` is `==`.
- Commits: conventional, imperative, subject ≤ 50 chars, first word not an acronym.

## Run / build / test

```sh
gjsify install
gjsify foreach -A check && gjsify foreach -A lint
gjsify workspace reminder-cli format:check
gjsify workspace reminder-cli build
gjsify workspace reminder-cli test             # GJS + Node
gjsify workspace reminder-cli test:eds         # opt-in: live EDS on a private bus (not in CI)
node app/tests/integration/mcp-gjs-smoke.mjs   # after build
```

The test script points `DBUS_SESSION_BUS_ADDRESS` at nothing, so no test can reach a real calendar.
A live check prints counts, never names or summaries. The MCP server is long-running: start it in
the background.
