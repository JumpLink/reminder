# 0002 — Priorities as linked reminders, read by any agent through the MCP server

- **Status:** Accepted
- **Date:** 2026-10-11

## Context

A person who runs many things at once needs to know the one thing to do next. Some keep that in a
markdown note: which priority is current, which long-running cases stand behind it, and for each
case a short status block (blocker, next single action, hard deadline, last-checked date) above a
long dated log. An agent that nags the person once a day reads that note, finds the case file, parses
its header table, checks whether the next step already happened, and writes a short message.

That works while one agent knows where the note is and how its table is laid out. It breaks when:

- a second agent, or a stranger's setup, needs the same answer: the layout is a convention, not an
  interface;
- the person wants to see or tick the next step on a phone: a markdown table is not on the phone;
- "days open" and "days to deadline" are computed by hand from a date someone remembered to update.

reminder already stores VTODOs in EDS (and CalDAV later), already reads `PRIORITY`, `DUE` and
`STATUS`, and already serves agents over MCP ([ADR 0001](0001-calendar-items-as-their-own-product.md)).
A priority is a VTODO with a deadline and next steps. This ADR makes that explicit.

The examples below are fictional.

## Decision

### 1. Data model: standard iCalendar, nothing a phone app cannot show

A **priority** is a VTODO in a configured task list.

| Concept | iCalendar | Notes |
|---|---|---|
| title | `SUMMARY` | "Renew the studio lease" |
| importance | `PRIORITY` 1–9 | RFC 5545; 0/unset = not a priority |
| hard deadline | `DUE` | date or instant; absent = no hard deadline |
| status | `STATUS`, `COMPLETED` | already read today |
| next steps | child VTODOs, one or several | see below |
| case file | `URL` | see below |
| rank | `PRIORITY` plus tie-break | see below |

**Next step.** Options:

- *(a) Child VTODO* with `RELATED-TO;RELTYPE=PARENT:<priority uid>`. The step is a first-class task:
  own `SUMMARY`, `DUE`, `CREATED`, tickable on a phone, and completing it is an ordinary
  `STATUS:COMPLETED` that every client understands. Cost: two components, and a reader must join
  them.
- *(b) A field on the priority* (the next step in `DESCRIPTION` or an X-property). One component,
  but no history, no tick, no own date; changing it overwrites the previous step silently.
- *(c) An X-property* (`X-REMINDER-NEXT-STEP`). Round-trips in CalDAV but is invisible in most apps,
  so the person cannot see or edit it where they look.

**Recommendation: (a).** `RELATED-TO` with `RELTYPE=PARENT` is the standard link, survives CalDAV, and
makes "progress" observable (§2). A priority may have **several open steps** (parallel tracks). A
reader returns all of them, oldest first, and flags the oldest as the one to nag about.

**Case file link.** Options: `URL` (RFC 5545, one value, shown as a link by most clients), `ATTACH`
(URI, can repeat, patchier client support), or a line in `DESCRIPTION`. **Recommendation: `URL`** on the
priority, holding any URI the person's tooling resolves (a `file:` path, a wiki page, a document
manager link). reminder stores and returns it verbatim and never fetches it.

**Rank — "the one top priority".** Options:

- *(a) `PRIORITY=1` unique.* Standard and visible on phones, but uniqueness is not enforceable in a
  store that other clients also write; two items at 1 would be a silent ambiguity.
- *(b) Explicit rank* in an X-property (`X-REMINDER-RANK`). Total order, but invisible to other apps
  and drifts from `PRIORITY` if a client edits only one.
- *(c) `PRIORITY` is the rank, ties break by `DUE` ascending, then `CREATED`, then `UID`.* A total
  order from standard fields; no extra property.

**Recommendation: (c).** `priorities_list` returns the ranked list; the first entry is "the top
priority". If two items share the lowest `PRIORITY` value, the response flags `tie: true` so a caller
can say so instead of picking silently. "Standing obligations" (things that keep moving regardless)
are the same VTODOs at `PRIORITY` 2–5; nothing special distinguishes them.

**Where they live.** One task list, **configurable**, in the existing config (`priorities.list`
naming a calendar uid, like routes do). No default: with none configured, `priorities_list` returns an
error saying so, not an arbitrary list. The same uid is the grant target (§4).

### 2. "Open since" and progress

Options for "how long has the priority had an open step":

- *(a) Derive from the `CREATED` of its oldest open step*, falling back to `DTSTAMP`. Standard, needs no extra data.
  `LAST-MODIFIED` is rejected as the base: any edit (typo fix, a sync touching the item) would reset
  the clock without progress.
- *(b) Explicit `X-REMINDER-OPEN-SINCE`.* Survives clients that rewrite `CREATED`, but a second
  source of truth and invisible to the person.

**Recommendation: (a), with `DTSTAMP` as fallback only.** Clients differ on `CREATED`; where it is
absent the age is reported as `null` rather than guessed. Fixing a wrong date is editing the step's
`CREATED`, which tools do not do.

**Open since of a priority** is the `CREATED` of its **oldest open step**. Each step also has its own
`daysOpen`.

**What counts as progress:** any step is completed or replaced. Adding a step through
`priorities_set_next_step` is *not* progress by itself (it adds a parallel track); replacing means
completing or cancelling a step and, if wanted, adding its successor. When the oldest step is
completed, the clock moves to the next-oldest open step. Editing text, moving `DUE` or re-ranking is
*not* progress. Days open is `today − created` of the oldest open step in the person's local date;
days to deadline is `priority.due − today` (negative = overdue).

### 3. Relationship to long-form case files

The case file stays the **log and the detail**: dated entries, reasoning, correspondence summaries,
whatever the person keeps. reminder holds only the **status block**: title, rank, hard deadline, the
open next steps, and a link to the case file. This is the status-vs-log split, with the status moved
from a table in the file header to a place that phones, calendars and agents read natively.

Consequences: the case file's header table stops duplicating status (it may link to the priority);
reminder never stores a blocker history, notes or "who it is waiting on" beyond the step's
`SUMMARY`/`DESCRIPTION`. Whether the step already happened (a sent mail, a reply) is for the agent to
judge from other tools; reminder only records what it was told.

### 4. MCP surface

Names follow the existing `<noun>_<verb>` pattern (`calendars_list`, `events_list`,
`reminders_list`).

| Tool | Kind | Returns / does |
|---|---|---|
| `priorities_list` | read | ranked items: `uid`, `summary`, `priority`, `due`, `daysToDeadline`, `daysOpen` (oldest open step), `link`, `tie`, `steps`: all open steps oldest first (`uid`, `summary`, `due`, `created`, `daysOpen`, `nag`: true on the oldest only) |
| `priorities_set_next_step` | write | adds a step under the priority; it never replaces or completes another |
| `priorities_complete_step` | write | takes a step `uid`, marks that step completed; other steps stay open |
| `priorities_rank` | write | sets `PRIORITY` on one item (callers re-rank by setting values; no bulk reorder) |

Reads follow the same limits and shapes as `reminders_list` (caps in `limits.ts`; no summaries in
logs). Today's date and the time zone come from the host, and the response carries the date it used so
a caller can show it.

**Writes sit behind a grant, fail-closed.** They need a new capability, `reminder.update` (ADR 0001
only has `*.create`), with the same rules: one capability, one exact calendar uid, no wildcard, a
missing grant is a refusal, and the check lives in the core function (`updateReminder`), not in the
tool. `priorities_set_next_step` only creates a VTODO, so it needs `reminder.create` on the same
target. The MCP server stays on `applyReadOnlyGate(server, false)` until `@gjsify/mcp`'s
`applyGrantGate` ships (gjsify PR #2145); `priorities_list` can ship before that, since it is
read-only. Writes come with the gate, not before.

Core changes this implies, listed so the follow-up work is bounded: `ReminderItem` gains `created`,
`url` and `parent` (the `RELATED-TO` uid); the reader parses them; an update path exists that
rewrites a component and keeps unknown properties.

### 5. Generic, multilingual

Nothing personal is hardcoded: no list name, no case-file path scheme, no priority naming. The list
uid, the link scheme and the rank semantics come from config or from the data. The rank and
deadline logic is language-free. Every user-facing string in the CLI/MCP output goes through gettext
with English msgids and a German catalogue from the first string, per the workspace rule; item
summaries are the person's own text and are never translated.

A CLI counterpart (`reminder priorities`) shares the core function with the MCP tool, as the other
commands do.

### 6. Migration

1. Until `priorities_list` exists, the markdown note stays the source and nothing changes for agents.
2. The tool ships read-only. The person creates the priorities and steps in their calendar app by hand
   (or the CLI); a daily agent can switch from parsing the note to one `priorities_list` call.
3. After a short overlap in which both are checked, the note's "current priority" section is replaced
   by a pointer to reminder, and the case files drop their duplicated status table.
4. Write tools follow with the grant gate.

No import tool is proposed: there are few priorities, and transcribing them is the review.

## Decisions (owner, 2026-10-11)

1. An item without `DUE` sorts last among equal `PRIORITY`, as proposed.
2. A single `URL` to the case file is enough; no `ATTACH`.
3. A priority may have **several open steps** (parallel tracks). Open-since is the `CREATED` of the
   oldest open step; `priorities_list` returns all open steps oldest first and flags the oldest as
   the one to nag about. Progress is any step completed or replaced.
   `priorities_set_next_step` adds a step; `priorities_complete_step` takes a step uid.
4. An EDS round trip of `RELATED-TO;RELTYPE=PARENT` must be tested. This is a requirement for the
   implementation: the first code PR includes that test. It does not block accepting this ADR.

## Consequences

- Phones and calendar apps show and tick priorities with no custom client.
- A client can edit `CREATED` and shift the clock; readers report what they find rather than hide it.
- `ReminderItem` and the iCalendar reader grow; the `CalendarBackend` port does not, because it
  already moves raw text and `getItem`/`createItem` cover the join. An in-place update needs a port
  method (`updateItem`) when the write tools are built, which is a separate decision at that point.
- `RELATED-TO` support differs across CalDAV servers and apps; the first code PR must include
  a test of the EDS round trip of `RELATED-TO;RELTYPE=PARENT`.
