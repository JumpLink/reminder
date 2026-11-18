# 0010 — Cache and synchronisation: raw responses with a version marker, derived and deletable

- **Status:** accepted
- **Date:** 2026-11-18

## Context

Every source a view shows is a network round trip or an EDS call. Opening the window on a train, or
with a slow server, should show what was there last time instead of an empty screen, and a source
that answers "unchanged" should cost one cheap request instead of a full download.

Two things make a cache dangerous in this product. It holds personal data (event titles, task
text) in a place the person did not choose, and a second representation of that data is a second
set of rules: if the view reads a "cached card" shape and the network path reads another, they
drift. [ADR 0006](0006-visibility-in-two-levels.md) already promised that a disabled source leaves
nothing behind.

## Decision

### 1. The cache holds the raw response, nothing derived

An entry is the source's answer exactly as it came — iCalendar text for CalDAV and EDS, JSON for a
board source — plus a **version marker** and the time of the fetch. The core parses cached text with
the same code that parses a network answer; there is no second representation.

The version marker is whatever the source offers to ask "has this changed": an ETag, a CalDAV
`ctag`, an `updatedAt` instant. It is an opaque string to the cache; only the source adapter
interprets it.

### 2. The key is one source

An entry is addressed by account id and source id (a calendar uid, a board id). `put` replaces the
whole entry; there is no merge. A cache can be cleared per source, per account or entirely.

### 3. Derived, deletable at any time

The cache is `derived` in the workstation's state manifest: nothing in it is irreplaceable, and
deleting the directory only costs the next start a full fetch. Code never depends on an entry being
present, and an unreadable or corrupt entry is a miss, never an error.

It lives under `$XDG_CACHE_HOME/<cacheDirName>`, with mode 0700 for directories and 0600 for files,
because it contains personal data. Writes are atomic (temporary file, then rename), so a crash
cannot leave half an entry that a later start reads as truth.

### 4. Never for a disabled source

A disabled source (ADR 0006) gets no entry: the cache wrapper asks the core's "is this source
enabled" function and turns `put` into a no-op and `get` into a miss. Disabling a source deletes
what is already there.

### 5. A failed fetch never empties a view

A failed fetch leaves the cache untouched. The failure is a **value** the view renders
(offline, stale, rejected credentials, no access, rate limit, unreadable answer) next to the data
it still has; "no cards" and "not loaded" look different. The state vocabulary is the core's, the
texts are gettext.

### 6. A port, not a path

`CacheStore` is a core port with `get`, `put`, `delete` and `clear`. `@reminder/cache-fs` is the
driver for hosts with a file system; a host without one (Android) brings its own. The core ships
an in-memory implementation for tests and for hosts that want no persistence.

## Consequences

- Fetch scheduling, intervals and back-off are a later decision; this ADR fixes only what is stored.
- Offline reading works for every source that was fetched once; writes to network sources stay
  refused offline (no queue in the first version).
- The cache directory needs a `derived` entry in the state manifest, or `werkstatt doctor` lists it.
- A source adapter that wants cheap revalidation must expose its marker as a string, or the cache
  degrades to "always refetch" for that source.
