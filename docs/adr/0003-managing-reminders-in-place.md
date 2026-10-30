# 0003 — Managing reminders in place: `reminder.update`, a rewrite that keeps what it does not know

- **Status:** accepted
- **Date:** 2026-10-30

## Context

[ADR 0001](0001-calendar-items-as-their-own-product.md) gave agents a way to *put* things into a
calendar, and its 2026-10-30 amendment put `events_create` / `reminders_create` behind
`applyGrantGate`. An agent can therefore fill a task list but never touch it again: the person ticks
every box by hand, and a reminder whose due date moved is a second reminder.

[ADR 0002](0002-priorities-as-linked-reminders.md) already depends on the missing half. Its write
tools (`priorities_complete_step`, `priorities_rank`) are completing and re-ranking VTODOs, it names
`reminder.update` as the capability they need, and its consequences note that "an update path exists
that rewrites a component and keeps unknown properties" is a prerequisite nobody has built.

The hard part is not the write. It is that reminder understands a *subset* of RFC 5545. A VTODO in a
real task list carries properties this code has never heard of — `RRULE`, `VALARM` children,
`CATEGORIES`, `ATTENDEE`, another client's X-properties, a `VTIMEZONE` in the surrounding
`VCALENDAR`. Rebuilding the component from the fields `ReminderItem` holds would silently delete
every one of them. "Edit the task's title" must not mean "drop the alarm the person set on their
phone".

## Decision

### 1. One new capability: `reminder.update`

`CAPABILITIES` gains `reminder.update`, under ADR 0001 §4's rules unchanged: a grant names **one**
capability and **one exact** task-list uid; no wildcard, no prefix, no case folding; an unknown
capability or an empty target is a `ConfigError` at load; **a missing grant is a refusal**. The check
lives inside `updateReminder`, after the target is resolved — not in a frontend.

`reminder.create` does not imply `reminder.update`. They are different risks: creating adds a row a
person can ignore, updating rewrites something they may already be acting on.

### 2. What an update may change

| Change | iCalendar |
|---|---|
| title | `SUMMARY` |
| notes | `DESCRIPTION` (clearable) |
| deadline | `DUE` (clearable) |
| importance | `PRIORITY` 1–9, 0/null clears |
| state | `STATUS`, with `COMPLETED` and `PERCENT-COMPLETE` kept consistent |

Completing sets `STATUS:COMPLETED`, `PERCENT-COMPLETE:100` and a `COMPLETED` stamp at the moment of
the write. Reopening sets `STATUS:NEEDS-ACTION` and **removes** `COMPLETED` and `PERCENT-COMPLETE`:
a task that is open again has no completion time, and a leftover stamp is what makes
`readReminder` call an item done even when `STATUS` says otherwise. `IN-PROCESS` and `CANCELLED`
drop `COMPLETED` and leave `PERCENT-COMPLETE` alone.

Every write bumps `SEQUENCE` (absent counts as 0) and sets `DTSTAMP` and `LAST-MODIFIED` to now, per
RFC 5545 §3.8.7. Times follow the create rules exactly: `YYYY-MM-DD` is a `VALUE=DATE`, anything else
needs an offset or `Z`, and **no time zone is ever guessed**.

An empty change set is an `InputError`, not a no-op write — a caller that meant something and sent
nothing should hear about it rather than get a `SEQUENCE` bump.

### 3. Delete is not included; `STATUS:CANCELLED` is

**No `reminder.delete`, no `deleteItem` on the port.** A delete is the one write a person cannot
inspect afterwards: nothing is left to look at, so a mistaken call is invisible until something is
missed. `STATUS:CANCELLED` says the same thing in a way every calendar app shows, every CalDAV
server syncs, and `reminders_list` already filters out by default (it is "not open"). It is
recoverable by setting the status back.

The cost is accepted: a task list accumulates cancelled rows, and the person empties it in their own
app. If a real need for deletion appears it is a new ADR with its own capability, not a flag on this
one.

### 4. Events are out of scope

No `calendar.update`, no `updateEvent`. An event others were invited to is not a private note: a
changed `DTSTART` has to go out as an `iTIP`/`METHOD:REQUEST` to every `ATTENDEE` with a bumped
`SEQUENCE`, and an update path that skips that leaves half the participants on the old time. That is
a decision about scheduling, not about rewriting text, and it gets its own record when it is wanted.

### 5. The port grows a version token and one write method

ADR 0001 §3 said the port "moves raw iCalendar text and nothing else". An in-place write needs one
thing more, and only one: a token that says *which version of the text we read*.

```ts
interface StoredItem { ical: string; etag: string | null }

getItem(calendarUid, kind, uid): Promise<StoredItem | null>   // was: Promise<string | null>
updateItem(calendarUid, kind, uid, ical, etag?): Promise<void>
```

The `etag` is **opaque**: the core stores it between the read and the write and never parses,
compares or displays it. Backends with no versioning (EDS) return `null` and ignore it. This is not
the port learning iCalendar — it is the port admitting that reading and writing the same object are
related, which is exactly what makes a lost update detectable.

`updateItem` takes the `uid` rather than a backend handle, so the port stays describable in one line.
CalDAV pays one extra lookup for it (§6); the alternative — an opaque locator travelling through the
core — buys a round trip with a type nobody can reason about.

### 6. CalDAV writes conditionally; EDS writes through ECal

- **CalDAV:** `PUT` with `If-Match: <etag>`. A `412` becomes a `ConflictError` (a `BackendError`
  subclass, so it crosses the boundary unwrapped), never a silent overwrite. The resource URL is
  looked up the way `getItem` looks it up — `<uid>.ics` first, then a scan, because other clients
  name resources freely. The ETag used is the one from the **original read**, not from that lookup,
  so the race the check exists for is actually covered.
- **EDS:** `ECal.Client.modify_object(comp, THIS, NONE, null)` on the iCalendar string, the same path
  `createItem` uses for `create_object`. EDS has no ETag; concurrent edits are whatever the
  evolution-data-server backend does with them. No raw `GLib.Error` crosses the port (ADR 0001).

### 7. The rewrite keeps everything it was not asked to change

`updateReminder` does **not** rebuild a VTODO from `ReminderItem`. It rewrites the stored text:
unfold, find the `VTODO` inside whatever wrapper it came in, replace or remove only the property
lines it was asked about, and emit **every other physical line verbatim** — original folding,
original parameter spelling, original order, `VALARM` children, the surrounding `VCALENDAR` and its
`VTIMEZONE`, and `X-REMINDER-SOURCE`, which therefore keeps the dedupe key (ADR 0001 §5) across an
update by doing nothing at all to it.

Verbatim means bytes, and the unit suite asserts bytes: a folded X-property and a `VALARM` come out
of an update identical to how they went in. A rewrite that normalises its input is a rewrite that
loses data on the second pass.

### 8. One MCP tool, three CLI commands

| Surface | Shape |
|---|---|
| MCP | **`reminders_update`** — `calendar`, `uid`, and any of `summary`, `description`, `due`, `priority`, `status` |
| CLI | `reminder update <uid>`, `reminder complete <uid>`, `reminder reopen <uid>` |

One MCP tool, not a `reminders_complete` beside it: completing is `status: "completed"`, reopening is
`status: "needs-action"`, and the ADR 0002 substitute for deleting is `status: "cancelled"`. A second
tool would mean a second gate, a second target resolution and a second schema for one enum value, and
every added tool is context an agent spends on every unrelated call. The CLI splits them because a
person types `reminder complete <uid>`, not a flag.

The tool is gated exactly like the create tools: no `reminder.update` grant means it is absent from
`tools/list`; `targetOf` resolves `calendar` (explicit, else `defaults.reminder`) and refuses any
target the grants do not name; `updateReminder` checks the same grant again.

## Consequences

- ADR 0002's `priorities_complete_step` and `priorities_rank` now have the core function and the
  capability they were written against. They are still unimplemented; this record does not add them.
- `getItem`'s return type changed, so every backend and the create path moved with it. That is the
  one caller-visible break ADR 0001 §3 warned about; it is accepted here rather than hidden behind a
  second read method that would duplicate CalDAV's lookup.
- A person who grants `reminder.update` on a task list has given an agent the ability to rewrite any
  task in it, including ones the agent did not create. The grant is per list, so the smallest useful
  grant is a list the agent owns.
- Recurring VTODOs are updated as their series definition (`THIS` on EDS); per-occurrence edits are
  not in scope, as with reads.
