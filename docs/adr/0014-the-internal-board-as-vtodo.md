# 0014 — The internal board as VTODO: `STATUS` + `X-STATUS`, order by `X-APPLE-SORT-ORDER`

- **Status:** accepted
- **Date:** 2026-11-20

## Context

The board of [ADR 0007](0007-boardsource-as-a-second-port.md) shows task lists next to Deck,
OpenProject and Zenkit, and [ADR 0013](0013-writing-to-boards.md) lets a person move a card. For the
three JSON sources a move is an API call. For a task list it is a question this ADR has to answer:
**which iCalendar lines carry a kanban column and a manual order?**

RFC 5545 gives a VTODO four `STATUS` values — `NEEDS-ACTION`, `IN-PROCESS`, `COMPLETED`,
`CANCELLED` — and no order at all. A four-lane board (ADR 0008 §1) needs one distinction RFC 5545
does not have (backlog versus todo, both `NEEDS-ACTION`) and one property RFC 5545 does not have
(where a card sits inside its lane).

[ADR 0008](0008-board-columns-and-mine.md) §2 wrote `X-REMINDER-BOARD-COLUMN:BACKLOG` into its
default-rules table as a placeholder. Shipping that would mean this program is the only thing on
earth that understands its own task lists: the same list opened in jtx Board, Tasks.org or Nextcloud
Tasks would show a stray X-line and no backlog, and a round trip through any of them could drop it.

So the question was researched before deciding (plan step 4.1): what do those apps already write?

### Research — what existing apps write

Read from source, November 2026. "verified" means the read **and** write site was found in code.

| App | Intermediate status | Manual order | Verified |
|---|---|---|---|
| [Nextcloud Tasks](https://github.com/nextcloud/tasks) | `STATUS:IN-PROCESS`, nothing beyond it | `X-APPLE-SORT-ORDER` | verified — [`src/models/task.js:163`](https://github.com/nextcloud/tasks/blob/main/src/models/task.js) reads it, `:815`/`:819` remove and write it; `getSortOrder()` is the fallback when absent. `IN-PROCESS` at `src/store/tasks.js:1486` and `src/models/task.js:316`. No backlog or kanban property exists. |
| [Tasks.org](https://github.com/tasks/tasks) | `STATUS` only | `X-APPLE-SORT-ORDER` | verified — [`kmp/src/commonMain/kotlin/org/tasks/caldav/iCalendar.kt:324`](https://github.com/tasks/tasks/blob/main/kmp/src/commonMain/kotlin/org/tasks/caldav/iCalendar.kt) defines the constant, `:415-418` is a `VTodo.order` accessor over `unknownProperty` / `setUnknownProperty`, `:501` assigns it on sync. Pinned by its own round-trip tests (`VTodoPreservationTest`, `ICalendarSyntaxTest`). |
| [jtx Board](https://github.com/TechbeeAT/jtxBoard) | **`X-STATUS`** — a free-text extended status next to the RFC one | nothing on the wire | verified for `X-STATUS` — [`ical4android/lib/src/main/kotlin/at/bitfire/ical4android/JtxICalObject.kt:273`](https://github.com/bitfireAT/ical4android/blob/main/lib/src/main/kotlin/at/bitfire/ical4android/JtxICalObject.kt) (`X_PROP_XSTATUS = "X-STATUS"  // used to define an extended status (additionally to standard status)`), parsed at `:595`, written at `:783`, tested in `JtxICalObjectTest.check_XSTATUS`. jtx's own `xstatus` column and `ExtendedStatus` table: `app/src/main/java/at/techbee/jtx/database/locals/ExtendedStatus.kt`. Its **kanban columns are local settings** (`ListSettings.kt`, `kanbanColumnsStatus2` / `kanbanColumnsXStatus2` / `kanbanColumnsCategory2`) and its `sortIndex` is a Room column that ical4android does not know (zero hits) — so order stays on the device. |
| Thunderbird, Evolution / EDS | — | — | unverified absence: a code search over `mozilla/releases-comm-central`, `GNOME/evolution` and `GNOME/evolution-data-server` for `X-APPLE-SORT-ORDER` returned nothing. Treated as "no evidence they write either property", not as proof. |

Two conclusions. `X-APPLE-SORT-ORDER` is the one property more than one app actually reads and
writes, and it is a number per task — no app invented a second one. And nobody writes a *column*: the
closest thing is jtx Board's `X-STATUS`, a refinement of `STATUS` that jtx shows and lets a person
edit, which is exactly the shape "backlog is a kind of needs-action" has.

## Decision

### 1. The column is `STATUS`, and backlog is `X-STATUS:BACKLOG`

The four lanes map onto what a VTODO already says, plus one line for the distinction RFC 5545 lacks:

| Lane | Written as |
|---|---|
| `backlog` | `STATUS:NEEDS-ACTION` **and** `X-STATUS:BACKLOG` |
| `todo` | `STATUS:NEEDS-ACTION`, no `X-STATUS` |
| `in-progress` | `STATUS:IN-PROCESS` |
| `done` | `STATUS:COMPLETED` (plus `COMPLETED` and `PERCENT-COMPLETE:100`, as `reminder.update` already writes) |
| `ignore` | `STATUS:CANCELLED` |

`X-STATUS` is jtx Board's property, not ours. A task this program puts in the backlog shows up in
jtx Board with the extended status "BACKLOG" — a value a person can see and change there — and in
Nextcloud Tasks and Tasks.org as a plain open task, which is what it is. Reading is wider than
writing: any `X-STATUS` value a foreign client wrote is matched against the name table of ADR 0008
§3 (`backlog`, `ideen`, `someday`, …), so a jtx user who called the column "Ideen" lands in the
backlog lane without configuring anything.

**This supersedes ADR 0008 §2's `X-REMINDER-BOARD-COLUMN:BACKLOG`.** No `X-REMINDER-` property is
written for the board. The one `X-REMINDER-` line that stays is `X-REMINDER-SOURCE`
([ADR 0001](0001-calendar-items-as-their-own-product.md) §5), which is a dedupe key no other app
could have a meaning for.

The price is honest: `X-STATUS` is one app's extension, not a standard, and jtx treats it as free
text. `BACKLOG` is therefore the written value and the name table does the reading, so a disagreement
about spelling costs a lane, never a task.

### 2. The order is `X-APPLE-SORT-ORDER`, an integer, gaps left on purpose

A card's position in its lane is `X-APPLE-SORT-ORDER:<integer>`, the property Nextcloud Tasks and
Tasks.org both read and write. Moving a card between two neighbours writes the midpoint of their
values; a new card gets the lowest existing value minus a gap. Positions are spaced by 1024 on a
fresh list so that an ordinary drag needs one write and not a renumbering of the column.

When the midpoint has no room left, the column is renumbered — every card in it, one write each,
reported as one operation. A list whose cards have no `X-APPLE-SORT-ORDER` at all is left alone until
something is moved; until then the view falls back to the same ordering the task list already uses
(due date, then created), which is what Nextcloud Tasks' own `getSortOrder()` fallback does.

A VTODO that carries a value from another client is reordered relative to it, never rebased onto a
scheme of ours. That is the whole point of picking the property two other apps already write.

### 3. Every other line stays byte-identical

A column change is `rewrite.ts`, not a serialiser: `rewriteComponent` replaces the `STATUS`,
`X-STATUS` and `X-APPLE-SORT-ORDER` lines of the `VTODO` and leaves every other physical line exactly
as it arrived — folding, parameter order, unknown properties, the `CRLF` or `LF` the server used
([ADR 0003](0003-managing-reminders-in-place.md)). Moving to `todo` removes the `X-STATUS` line
(`{ name: 'X-STATUS', line: null }`); it does not write an empty value.

The write goes through `updateReminder`, so it bumps `SEQUENCE` and restamps `DTSTAMP` and
`LAST-MODIFIED` like every other change, and it sends `If-Match` with the ETag it read. The gate is
the byte comparison `update.test.ts` already uses: a fixture with folded lines, a `TZID`, an
`X-MOZ-LASTACK` and an `X-APPLE-SORT-ORDER` from a foreign client, moved one lane, differing in
exactly the expected lines.

This is also why the board write for VTODO is **not** a new write path. `moveCard` on a `vtodo`
source builds a `ReminderChanges` plus two property edits and calls the function the task view
already calls. One place writes VTODOs.

### 4. The board's own cards live in a plain task list, and `@reminder/vdir` provides one

An internal board needs somewhere to put a card that belongs to no server. That place is an ordinary
VTODO collection, so it is readable by every app above and backed up like any other list — not a
database of our own.

`@reminder/vdir` is a `CalendarBackend` (ADR 0016's port) over a vdir directory: one `.ics` file per
item, the file's `mtime` + size as its ETag, the directory as the collection. It passes the same
contract test as the EDS and CalDAV backends, which is what makes it a backend rather than a
shortcut. It works everywhere the application runs — a server with no D-Bus session, a Flatpak
without EDS, a phone later — and "Create a local list" in the setup flow creates one.

### 5. On the desktop, a local EDS list is offered as well — open question 8

On a GNOME desktop a local EDS task list has one advantage vdir cannot have: GNOME To Do, Evolution
and the Shell see the same tasks without configuring anything.

**Proposed default: vdir, with the local EDS list offered in the setup flow on desktops where EDS is
reachable.** The reason is that vdir behaves identically everywhere, so a bug report is about one
backend; EDS adds a local-only shape that only some installations have, and a Flatpak without EDS
would otherwise have no internal board at all. Choosing EDS as the default would make the feature
depend on the one part of the stack that is not always there.

This is **plan open question 8** and it stays open for Pascal. Nothing else in this ADR depends on
the answer: both are `CalendarBackend` implementations behind the same port, the board source is the
same `createVtodoBoardSource`, and the decision is one value in the setup flow.

## Consequences

- The internal board writes only properties other apps already write. A list moved around by this
  program stays usable in jtx Board, Tasks.org and Nextcloud Tasks, and their edits come back as
  lanes and positions rather than as noise.
- ADR 0008 §2's vtodo row changes to `X-STATUS` and gains the `X-APPLE-SORT-ORDER` ordering; its name
  table is reused for reading `X-STATUS` values, so adding a language helps the backlog lane too.
- `X-STATUS` is a single vendor's extension with free-text values. If jtx Board ever gives it
  structure, the reading side is a name-table change and the writing side is one constant.
- Only `backlog` needs a non-standard line. Three of the four lanes and `ignore` are pure RFC 5545,
  so a list that never uses the backlog has no extensions in it at all.
- Reordering a full column is N writes. The view has to show that as one operation and must not
  renumber during a drag, or a slow list feels broken.
- `@reminder/vdir` is a third backend to maintain, and the contract test is what keeps the cost
  bounded. It is also what makes a server-side or Flatpak install work without EDS.
- Open question 8 (EDS or vdir on the desktop) is for Pascal. Until it is answered the setup flow
  implements the proposed default: vdir, EDS offered where it is reachable.
