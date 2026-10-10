# AGENTS.md — reminder

Operating guide for AI agents in the **reminder** repo. Follows the [agents.md](https://agents.md/)
convention; human overview in [README.md](README.md). **This file is a router:** what an agent
needs before opening anything stays here; the reasoning lives in [docs/](docs/README.md).

## What this is

Calendar events (VEVENT) and reminders (VTODO) as a CLI and an MCP server, on GJS via gjsify. A
TypeScript monorepo: pure `packages/*` plus one `app` workspace that carries the gjsify toolchain
and picks a frontend at the yargs entrypoint. Scope, backends and grants:
[ADR 0001](docs/adr/0001-calendar-items-as-their-own-product.md).

## Hard rules

| Rule | Why |
|---|---|
| **Public repo: no personal data** | No real calendar uids, addresses, names or events — in code, tests, fixtures, docs, commits. Placeholders (`<calendar-uid>`, `example.org`) only. The real config lives in `$XDG_CONFIG_HOME`, never here |
| **Writes need a grant, per capability and exact target** | Missing grant = refusal; wildcard/empty/unknown capability = `ConfigError` at load. The check lives inside `createEvent` / `createReminder`, never in a frontend |
| **No MCP write tool before `applyGrantGate`** | The server runs `applyReadOnlyGate(server, false)`. A create tool waits for `@gjsify/mcp`'s grant gate (gjsify PR #2145) and an ADR |
| **Dedupe by source key** | Every create takes `source` + `sourceId`; the key goes into `X-REMINDER-SOURCE` and decides the UID. A UID holding a different key is an error, never a merge |
| **The backend port moves iCalendar text only** | Parsing, dedupe, grants, routing stay in `@reminder/core`. A backend that parses is a second copy of the rules |
| **No raw native error crosses a backend** | Wrap as `BackendError` / `BackendUnavailableError` — a `GLib.Error` JSON-serialises to `{}` |
| **Never guess a time zone** | Unresolvable TZID stays floating; create input needs an offset, `Z`, or a bare date |

## Package layout

| Package | What | May import |
|---|---|---|
| `@reminder/core` | types, errors, `CalendarBackend` port, iCalendar, grants, routing, config model, read + create | nothing (`types: []`) |
| `@reminder/eds` | EDS driver for the port; typelibs load lazily | `@reminder/core`, `gi://` |
| `reminder-cli` (`app/`) | yargs CLI, MCP server, config file I/O, backend factory | everything |

A new backend (CalDAV) is a new package implementing `CalendarBackend` plus a `backend` value in
`BACKENDS`; callers do not change.

## Conventions

- Files with a `gi://` import are named `*.gjs.ts`; EDS namespaces are imported **type-only** at top
  level and loaded through `optionalNamespace` (see `packages/eds/src/optional.ts`).
- No TS parameter properties (Node runs the sources with strip-types). No `any`.
- User-facing strings in English. Sort with code-unit compare, not `localeCompare`.
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
node app/tests/integration/mcp-gjs-smoke.mjs   # after build
```

The test script points `DBUS_SESSION_BUS_ADDRESS` at nothing, so no test can reach a real calendar.
A live check prints counts, never names or summaries. The MCP server is long-running: start it in
the background.
