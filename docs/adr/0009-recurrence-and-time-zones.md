# 0009 — Recurrence through a proven library, and where a time zone comes from

- **Status:** accepted
- **Date:** 2026-11-19

## Context

[ADR 0001](0001-calendar-items-as-their-own-product.md) decided, as a consequence, that this
product does **not** expand recurrences: a series is shown as its definition. That was right while
the only frontends were a CLI and MCP, where an agent reads `RRULE:FREQ=WEEKLY` and understands it.
A calendar view cannot: a month grid has to know which days a weekly series actually lands on.

Writing a recurrence expander is a bad use of this project's time. RFC 5545 §3.8.5 and §3.3.10 are
full of cases that look simple and are not — `BYSETPOS`, `BYDAY=-1SU`, `COUNT` interacting with
`EXDATE`, an `RDATE` that duplicates a rule instance, an override whose `RECURRENCE-ID` names a
slot the rule no longer produces. Every calendar project that wrote its own got them wrong first.

Underneath sits a harder problem the core already has a rule for: **never guess a time zone.**
`@reminder/core`'s `parseTime` resolves a `TZID` through the host's `Intl` and leaves the value
floating when it cannot — it does not fall back to the machine's local zone, because the same
input would then mean different instants on two machines. An expander multiplies that decision: a
daily series across a DST switch is wrong in *every* later instance if the zone is wrong once.

## Decision

### 1. Expansion is read-only, in its own package

A new package **`@gjsify/recurrence`**, MIT, under its final name from the first commit
([ADR 0016](0016-gjsify-pim-incubates-here.md)). It depends on `ical.js` and on nothing of this
app — no `@reminder/*`, no `@gjsify/pim` — so `@reminder/core` stays dependency-free and the
package moves to gjsify unchanged.

Nothing in it writes iCalendar. An expansion can therefore never corrupt a calendar, and the write
path keeps working on the series **definition** (`@reminder/core`'s `rewrite.ts`, byte-preserving),
exactly as ADR 0001 §4 and ADR 0003 set it up. Editing one instance of a series is a separate
decision and is not taken here.

### 2. ical.js, not our own expander

`ical.js` 2.2.1: MPL-2.0, **no dependencies**, ESM, the implementation Thunderbird's calendar
ships. `RecurExpansion` covers `RRULE`, `RDATE` and `EXDATE`; `Component`/`Property` give us the
parse tree for `RECURRENCE-ID` overrides, which the package assembles itself.

MPL-2.0 is file-level copyleft. It reaches ical.js's own files, not this MIT package and not the
app — a dependency licence, not the package's licence.

### 3. Zones resolve in one fixed order, and the last step is honest

**`VTIMEZONE` from the item itself → the `TZID` read as an IANA name against the host's `Intl` →
floating, flagged.**

The sender's own table wins, because it is the only artefact that is certainly what the sender
meant. Failing that, the host has a zone database the OS keeps current. Failing both, the time
stays floating and `expand` reports the `TZID` in `unresolvedZones` so a view can mark it. There is
no fourth step: the local zone is never substituted for an unknown one.

ical.js's bundled IANA database is **not** used — and it could not have been a mere fallback,
because the stock package ships **no** zone data at all (measured: `TimezoneService.count === 0` on
both runtimes; its README says so). The optional `ical.timezones.js` is a generated table outside
the distribution that goes stale between releases, against a host database that does not.

### 4. The window cache is part of the design, not an optimisation

ical.js cannot seek: `RecurExpansion` always starts at the series start and steps forward. A daily
series that began in 2015 costs several thousand iterations before the first instance a month view
asks for, and a view that scrolls asks again every month.

So expansions are cached per **uid + version + window**, where the version is the source's
ETag/ctag ([ADR 0010](0010-cache-and-synchronisation.md)). A changed ETag means different text,
so every window derived from it is stale. A source that sends **no** version marker is keyed under
a marker no real ETag can equal, so its entries are never reused across a refetch. The cache is
in-memory and derived — any entry may be dropped at any time, which does not contradict ADR 0010:
that one holds the raw texts on disk, this one holds a result in RAM.

### 5. A per-series cap that says what it cut

A rule may be infinite and a window may be a decade. One malformed `FREQ=SECONDLY` would otherwise
fill memory and the view that asked for a month would never paint. So: at most
`maxPerSeries` (1000) instances kept per series, and at most `maxScanPerSeries` (200 000)
iterations spent on one. Both report what happened in `cuts` — `kept`, `cut`, and `exact: false`
when the scan ceiling stopped the counting, so `cut` reads as a lower bound. Silently truncating a
calendar is the one outcome not allowed.

## The spike: measurements

Run on this workstation, 2026-11-19, on both runtimes the product targets.

### Host zone databases

| Runtime | Version | `Intl.supportedValuesOf('timeZone')` | `Europe/Berlin` Jul / Jan |
|---|---|---|---|
| GJS | 1.90.1 | 449 zones | GMT+02:00 / GMT+01:00 |
| Node | v24.19.0 | 418 zones | GMT+02:00 / GMT+01:00 |

Both resolve the host zone (`Europe/Berlin`) and every name tried. The count differs because the
two embed different ICU builds; the difference is in aliases, not in the zones a calendar names.

**NativeScript could not be checked here** — there is no Android target in this worktree. Step 5.1
of the plan must verify `Intl.DateTimeFormat` with a `timeZone` option on the Android runtime
before the mobile frontend relies on step 2 of the order. If it is missing there, the fallback is
to ship a zone table on that platform only; the resolution order itself does not change.

### `Intl`-derived offsets against the item's own `VTIMEZONE`

A `Europe/Berlin` `VTIMEZONE` as a server sends it, against `IntlTimezone`, same series, same
window. Both runtimes produced **byte-identical** output.

| Wall clock (Europe/Berlin) | via `VTIMEZONE` | via `Intl` |
|---|---|---|
| 2026-03-29 01:30 (before the gap) | `2026-03-29T00:30:00Z` | `2026-03-29T00:30:00Z` |
| 2026-03-29 02:30 (**does not exist**) | `2026-03-29T00:30:00Z` | `2026-03-29T00:30:00Z` |
| 2026-03-29 03:30 (after the gap) | `2026-03-29T01:30:00Z` | `2026-03-29T01:30:00Z` |
| 2026-10-25 01:30 (before the overlap) | `2026-10-24T23:30:00Z` | `2026-10-24T23:30:00Z` |
| 2026-10-25 02:30 (**happens twice**) | `2026-10-25T01:30:00Z` | `2026-10-25T01:30:00Z` |
| 2026-10-25 03:30 (after the overlap) | `2026-10-25T02:30:00Z` | `2026-10-25T02:30:00Z` |

Daily series across both switches, and a monthly series with `UNTIL` spanning one, agree
instance for instance. The rule that makes the two meet is libical's: a wall clock in a gap takes
the offset **after** the change, one in an overlap the offset **before** it.

Two defects were found by this measurement and fixed in `zones.ts`, both in our `Intl` arithmetic
and neither in ical.js:

- an unaligned instant made `Intl`'s second-resolution wall clock return the millisecond remainder
  as a **fractional** offset (`3599.012` for `Europe/Berlin`), which then travelled into every
  derived instant;
- a transition search that was not second-aligned put the spring-forward instance **one second**
  past where `VTIMEZONE` puts it (`…T01:30:01Z` instead of `…T00:30:00Z`).

Both are why the comparison above exists as a test rather than as an argument.

### `TimezoneService` is a process-wide singleton

`ICAL.TimezoneService` is global state. Two calendars can disagree about what `Europe/Berlin` meant
in 1980, and without care the second expansion inherits the first one's table. `ZoneScope` records
what was registered under each name it touches and puts it back; `reset()` is not used, because it
would drop entries this package never owned.

## Consequences

- The calendar view (plan steps 3.4–3.6), "today" in the task view (3.7) and an explicit `expand`
  option on `events_list` (3.8) can be built on one expander instead of three.
- ADR 0001's "no expansion" consequence is **amended, not reversed**: reading expands, writing
  still edits the series definition.
- `@reminder/core` gains no dependency. The app depends on `@gjsify/recurrence`, which depends on
  `ical.js` — one new runtime dependency, MPL-2.0, no transitive ones.
- An unresolvable `TZID` reaches the UI as a fact (`floating: true` plus the `TZID` as written),
  which means every view has to show it. A view that drops the marker shows a time that means
  nothing.
- The Android check is open; until the NativeScript runtime has been measured, the mobile frontend
  must not assume step 2 of the order.
