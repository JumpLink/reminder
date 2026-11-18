# 0017 — Sync schedule and states: one service in the core, states as values

- **Status:** accepted
- **Date:** 2026-11-18

## Context

[ADR 0010](0010-cache-and-synchronisation.md) fixed what the cache stores and left open when a
source is fetched, how a failure shows and how often to retry. Every frontend that stays open
(the GUI first) needs that answer, and it must be the same one: a second scheduler per frontend
would be a second set of rules.

## Decision

### 1. One service, pure TypeScript, time and network as ports

`createSyncService` lives in `packages/core/src/sync/`. It takes a `CacheStore`, a fetch port, a
`SyncClock` and a `SyncScheduler` (`setTimeout`/`clearTimeout`). It imports no GLib and no global
timer; tests drive time by hand. The fetch port is
`fetch(key, previousVersion) → { kind: 'changed', body, version } | { kind: 'unchanged' }`, and a
failure is a throw.

### 2. States are values

Per source (account id + source id, the `CacheKey`) the service holds a `SourceStatus`: a
`SyncState` and the time of the last success (`null` = never fetched).

| State | Cause | Next attempt |
|---|---|---|
| `pending` | no attempt finished yet (cached data, if any, is shown) | now |
| `current` | last fetch succeeded or answered "unchanged" | after the kind's interval |
| `stale` | offline, timeout, 5xx, anything unclassified | back-off |
| `auth-rejected` | 401 | **none** until `reauthenticated(account)` |
| `no-access` | 403, with the reason | back-off |
| `rate-limited` | 429, or 503 with a wait; carries `retryAt` | the server's retry-after, else back-off |
| `unreadable` | the answer did not parse | back-off |

`classifyFetchError` is the pure mapping. It reads the errors the backends already throw —
`BackendError` with `domain: 'http'` and the status in `code`, `BackendAuthError`,
`BackendUnavailableError` — plus two new ones: `SyncHttpError` (a status with an optional
Retry-After) and `UnreadableAnswerError`. Texts are not in the core; the GUI maps states to gettext.

### 3. Cache first, then fetch

`start()` publishes the cached entry of every enabled source (state `pending`, `lastSuccessAt` =
the entry's fetch time) before any fetch. A failed fetch never touches the cache. An "unchanged"
answer rewrites only the entry's `fetchedAt`.

### 4. Triggers, intervals, back-off

Triggers: `start()`, `focus()` (skips a source whose last attempt ended less than 30 s ago, one
rate-limited before its `retryAt`, and one rejected with 401), the per-kind interval, and a manual
`refresh()` of one source or all (it overrides a rate limit, never a 401 stop).

Intervals per source kind: caldav 5 min, eds 2 min, deck 2 min, openproject 5 min, zenkit
10 min. Each failure doubles the wait, capped at 30 min; a success resets it. At most 2 fetches run
against one host at a time. All of these are constants in `limits.ts`.

### 5. Disabled sources are never scheduled

`enabledSyncSources` filters through the visibility rule of [ADR 0006](0006-visibility-in-two-levels.md);
`setSources` adds or removes sources at runtime. `stop()` cancels every timer and ignores a result
still in flight.

## Consequences

- No frontend writes its own scheduler; it subscribes and renders states.
- `auth-rejected` needs a caller that knows when credentials changed and calls `reauthenticated`.
- Source adapters must throw `SyncHttpError` (or a `BackendError` with `domain: 'http'`) to get a
  precise state; anything else reads as `stale`.
- CalDAV delta (ctag/sync-token) is a later step; the `previousVersion` argument is its hook.
