# 0016 — `@gjsify/pim`: the backend port and its drivers incubate here

- **Status:** accepted
- **Date:** 2026-11-18

## Context

Two apps read calendars: reminder (`@reminder/caldav`, `@reminder/eds`) and curlew
(`packages/gnome`, read-only EDS). Both grew their own EDS code from the same origin, and both will
need CalDAV and, for curlew, CardDAV. A third copy is the next step if nothing changes.

The port reminder already has, `CalendarBackend`, is app-neutral: it moves iCalendar text and
nothing else. Grants, routing, dedupe and parsing sit above it in `@reminder/core`. So the port and
its drivers can serve both apps without carrying reminder's rules along.

## Decision

1. **One package, `@gjsify/pim`, MIT, under its final name from the first commit.** It holds the
   `CalendarBackend` port, its types (`CalendarInfo`, `ItemKind`, `RawItem`, `ItemQuery`,
   `StoredItem`), the backend errors (`PimError`, `BackendError`, `BackendAuthError`,
   `ConflictError`, `BackendUnavailableError`) and `optionalNamespace`.
2. **CalDAV is the standard, EDS one driver among several.** Drivers are subpath exports:
   `@gjsify/pim/caldav` (plain fetch over `@gjsify/dav`, every runtime) and `@gjsify/pim/eds`
   (typelibs loaded on first use). The root entry stays pure, so `@reminder/core` keeps
   `types: []` while depending on it.
3. **Nothing app-specific inside.** The PRODID a CalDAV write uses is an option
   (`CaldavOptions.prodId`); reminder passes its own from `IDENTITY`. Messages go through a
   translator hook (`setPimTranslator`); `setCoreTranslator` forwards to it, so the backends'
   msgids stay in reminder's catalogue. The package never imports `@reminder/*`.
4. **It incubates in `packages/pim` and moves to gjsify when complete** — CardDAV and curlew's EDS
   address book included, tested, documented. The move relocates the directory and nothing else.
   reminder uses it now; curlew switches from `packages/gnome` only after the move.
5. `@reminder/core` re-exports the port and the errors, so frontends keep one import.

## Consequences

- `@reminder/caldav` and `@reminder/eds` are gone; their code lives on in `packages/pim/src/caldav`
  and `packages/pim/src/eds` with history (`git mv`).
- `ReminderError` no longer is the base of the backend errors. Code that must catch every failure
  checks `PimError` as well; the existing callers only branch on the concrete classes.
- Until the move, the package is `private` and versioned with reminder.
