# 0007 — `BoardSource` as a second port: a normalised card, read-only first

- **Status:** accepted
- **Date:** 2026-11-19

## Context

[ADR 0004](0004-the-ui-is-next-three-views-on-the-same-core.md) named **board** as one of the three
views: a kanban across sources. The sources it has to cover are Nextcloud Deck, OpenProject and
Zenkit — three JSON APIs — plus the task lists this program already reads as VTODO.

`CalendarBackend` cannot serve them. Its contract is that it moves iCalendar TEXT and nothing else
(`AGENTS.md`, [ADR 0016](0016-gjsify-pim-incubates-here.md)), which is what keeps every driver a
transport instead of a second copy of the rules. Pressing a Deck card into a VTODO would mean a
driver inventing `STATUS` from a stack name, dropping the labels and the board URL, and inventing a
UID — a lossy conversion, decided inside a driver, that the core could never undo.

The alternative is a second port. The cost is a second shape in the core; the gain is that neither
port has to lie about what its sources are.

## Decision

### 1. A second port, next to `CalendarBackend`, not instead of it

`BoardSource` lives in `packages/core/src/board/`. `CalendarBackend` is unchanged and keeps moving
iCalendar text only. VTODO task lists appear on the board through `createVtodoBoardSource`, a **core
adapter** that sits on a `CalendarBackend` — not through a new method on it and not through a driver
that learned about boards.

### 2. Adapters normalise; they decide nothing

A `BoardSource` maps its API's shape onto the card model and stops there. Column rules, the "mine"
filter and visibility are [ADR 0008](0008-board-columns-and-mine.md) and
[ADR 0006](0006-visibility-in-two-levels.md), and they live in the core — the same rule
[ADR 0004](0004-the-ui-is-next-three-views-on-the-same-core.md) §2 states for frontends. An adapter
that mapped a stack name to "Done" would be a rule the CLI, the GUI and MCP each see differently.

An adapter reports the column **verbatim** (`sourceColumn`) and reports what the source itself says
about being finished (`closed`), because `isClosed`, `COMPLETED` and `archived` are facts of the
source, not an interpretation of a name.

### 3. The card model

```ts
interface Card {
  ref: { source: string; board: string; id: string };
  title: string;
  sourceColumn: string;        // verbatim; shown, and read by the rules
  closed: boolean | null;      // what the source itself says; null when it has no such notion
  due: string | null;          // the three time shapes of `types.ts`; never guessed
  assignees: SourceUser[];     // each with `isMe`
  watchedByMe: boolean | null; // null: the source has no watching concept (Deck)
  labels: { name: string; color: string | null }[];
  url: string | null;          // the card in its own web UI; null when the source has none
  version: string | null;      // opaque, like the etag of ADR 0003
  updated: string | null;
}
```

No description, no comments, no attachments. The board stays cheap to fetch and to render, and an
MCP answer cannot carry a body of text nobody asked for — the privacy rule of the hub `AGENTS.md`.

`null` is used where a source has no such notion, and is never collapsed into `false`: "nobody
watches this" and "this source cannot tell you" are different answers, and only the first one may
drive a filter.

### 4. Change detection is a hook on the port, same shape as sync

`listCards(board, query, since?)` takes the change token of the previous read and may answer
`{ kind: 'unchanged' }`. That is the fetch port of
[ADR 0017](0017-sync-schedule-and-states.md) §1 in the board's vocabulary, so a board source plugs
into the existing sync service and the existing cache
([ADR 0010](0010-cache-and-synchronisation.md)) without a second scheduler. The token is **opaque**
to everything above the adapter: Deck's ETag, OpenProject's `updatedAt` watermark and a VTODO
collection's ctag never get compared, only handed back.

`describe()` reports `changeToken: boolean` so a caller knows whether "unchanged" is possible at all
rather than inferring it from a source that simply never answered it.

### 5. Read-only, and the capability says so

`describe()` reports `canWrite: false` for every source in this phase. Writing to a board is a new
capability and therefore its own decision (ADR 0013 of the plan), exactly as
[ADR 0001](0001-calendar-items-as-their-own-product.md) §4 requires for every write. The flag exists
now so that the GUI can grey out what it must not offer, and so that adding a write later is a
change in one adapter plus a grant, not a change to the port.

### 6. Every card carries its link home, where there is one

`Card.url` and `BoardRef.url` are `string | null`, and a source that has a web UI must fill them. A
board that aggregates three systems is only usable if every row can hand the person back to the
system that owns it, so a source whose URL shape is uncertain gets it verified against a test
instance rather than left out.

`null` is for sources that genuinely have no page: a plain CalDAV task list is a collection of
`.ics` resources and nothing on the other end renders a task. An adapter never builds a plausible
URL to avoid the `null` — a link that 404s is worse than a button the view can hide.

### 7. One contract test, exported, run by every adapter

`boardSourceContract(makeSource)` is exported from `@reminder/core` and run by each adapter package
under GJS and Node both. It is what "implements `BoardSource`" means: the five methods, stable refs,
`listColumns` covering every `sourceColumn` the cards use, the `unchanged` answer, and the read-only
flags. A fourth source is then a package plus one line in a test file.

## Consequences

- The core gains a second port. `AGENTS.md`'s "the backend port moves iCalendar text only" is about
  `CalendarBackend` specifically, and gets `BoardSource` as its own line: adapters normalise, decide
  nothing.
- VTODO lists show up on the board without a second storage and without a copy: the adapter reads
  through the same `CalendarBackend` the task view uses, so a task ticked in one view is the same
  task in the other.
- The sync service and the cache serve boards unchanged, because the port speaks their shape.
- `Card` is deliberately poorer than every source's own model. A field a view turns out to need is
  an amendment here, not a field smuggled into an adapter.
- Three adapters will each need a fake server with invented data; none is ever tested against a real
  account.
