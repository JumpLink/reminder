# 0018 — CalDAV delta sync: an opaque marker, a fallback chain, raw texts as the cache body

- **Status:** accepted
- **Date:** 2026-11-18

## Context

[ADR 0010](0010-cache-and-synchronisation.md) promised that a source answering "unchanged" costs
one cheap request, and [ADR 0017](0017-sync-schedule-and-states.md) left CalDAV delta as a hook:
the `previousVersion` argument of the fetch port. This ADR fills it.

## Decision

### 1. The driver reads a delta; the port does not change

`@gjsify/pim/caldav` exports `createCaldavDeltaReader(options)`. Its `read(collectionUrl, kind,
previous)` takes the remembered `{ marker, items }` (or `null`) and returns
`{ kind: 'unchanged', marker }` or `{ kind: 'changed', marker, items }`. An item is
`{ href, etag, ical }`: the driver still moves iCalendar text only, parsing stays in the core. It is
a second entry point next to `createCaldavBackend`, not a method on `CalendarBackend`, because EDS
has no marker and the port stays what both drivers can honour.

### 2. The marker

JSON `{"v":1,"ctag":string|null,"syncToken":string|null}`: what the collection's own PROPFIND
reports. Callers treat it as opaque (ADR 0010 §1). A marker that does not parse, or has another
`v`, counts as none and the read is a full one.

### 3. The fallback chain

Every read starts with ONE PROPFIND on the calendar home (it lists all collections, with ctag and
sync token). Home discovery happens once per reader.

1. No usable previous → full read.
2. The server offers a version (ctag or sync token) and every offered value equals the previous
   one → `unchanged`. Total cost: one request. A server that offers neither can never prove
   "unchanged".
3. Both markers carry a sync token → RFC 6578 `sync-collection`. Deleted hrefs are dropped,
   changed hrefs are fetched with a multiget (the report carries etags only), the rest is kept.
4. The server answers the token with 403, 409 or 507 (RFC 6578 §3.2: invalid token) → full read.
5. No sync token (ctag-only server, or none stored) and the ctag differs → full read: a
   calendar-query for the hrefs, then multiget in chunks of 50.

### 4. Errors

401, 403, 429 and 5xx become `BackendError` with `domain: 'http'` and the status in `code` (401 as
`BackendAuthError`), which `classifyFetchError` already maps to a state. Anything else is wrapped
with the call's name; no native error crosses.

### 5. The cache body

The adapter `createCollectionSyncFetch(cache, read)` in the core turns a collection into the sync
service's `FetchResult`; the core imports no driver, the app binds the reader. The body is a JSON
array of `{ href, etag, ics }`. JSON keeps each text byte-exact (CRLF, folding) and the entry one
atomic file as ADR 0010 requires; the href is the key a later delta merges on, which a bare
concatenation of VCALENDARs would lose. The adapter reads the entry itself, because the marker
alone cannot merge; a body that does not decode, or whose version differs from the marker the
service passed, means no previous and a full read, never an error.

## Consequences

- An unchanged collection costs one request, per collection (the home PROPFIND is not shared
  across collections yet).
- Cache bodies of CalDAV collections are JSON, not iCalendar; the core extracts `ics` before parsing.
- `@gjsify/dav` gaps, handled by status code: no typed "token rejected" error, and no Retry-After on
  `DavError` (so a 429 reads as plain `rate-limited`, back-off only).
- Not wired into the CLI, MCP or GUI yet.
