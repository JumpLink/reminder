# 0008 — Four columns, default rules per source type, and what "mine" means

- **Status:** accepted
- **Date:** 2026-11-19

## Context

[ADR 0007](0007-boardsource-as-a-second-port.md) gives every card a `sourceColumn` verbatim: a Deck
stack title, an OpenProject status name, a Zenkit choice value, a VTODO `STATUS`. A board that shows
four sources side by side cannot show four sets of columns — the point of the view is that one
glance covers everything a person has to do.

So something has to map many source columns onto a few shared ones, and something has to decide
which cards are the person's own. Both are rules, and
[ADR 0004](0004-the-ui-is-next-three-views-on-the-same-core.md) §2 puts rules in the core: a mapping
done in the GUI is a mapping the CLI and MCP do not have.

Two traps to avoid. The first is guessing: a column nobody can place quietly becoming "Todo" means a
card sits in a lane it was never in, and nothing says so. The second is translating: a person whose
Deck says "In Arbeit" and whose OpenProject says "In progress" has one lane, not two.

## Decision

### 1. Four target columns plus `ignore`, and `unassigned` as a value

```ts
type TargetColumn = 'backlog' | 'todo' | 'in-progress' | 'done' | 'ignore' | 'unassigned';
```

`backlog`, `todo`, `in-progress` and `done` are the four lanes the board draws. `ignore` is a
deliberate "do not draw this at all" (a cancelled VTODO). **`unassigned` is the answer when no rule
matched** — it is a value like any other, never a silent fallback to `todo` and never a silent drop.
The setup UI lists the unassigned columns of a board and asks once; until the person answers, the
cards are shown in a lane the view labels as unassigned rather than hidden.

### 2. Default rules per source type, in the core

| Source | backlog | todo | in-progress | done | ignore |
|---|---|---|---|---|---|
| `vtodo` | `X-REMINDER-BOARD-COLUMN:BACKLOG` | `NEEDS-ACTION`, no status | `IN-PROCESS`, else `PERCENT-COMPLETE` > 0 | `COMPLETED`, else `PERCENT-COMPLETE` = 100 | `CANCELLED` |
| `openproject` | name match | `isDefault`, else any other open status | name match | `isClosed` | — |
| `deck` | name match | name match | name match | name match, `archived` | — |
| `zenkit` | name match | name match | name match | name match | — |

What the source states about itself wins over its name: `isClosed`, `COMPLETED` and `archived` are
facts (ADR 0007 §2), a stack called "Fertig" is a string. For VTODO, `STATUS` is checked before
`PERCENT-COMPLETE`, because a task may carry a percentage and an explicit status that disagree, and
the explicit one is what a person set.

A source type with no useful fact of its own (Deck, Zenkit) falls back to the name table, and to
`unassigned` when that misses.

### 3. The name table is German and English, in one place

Matching is on a **normalised** key: lower-cased, punctuation and extra whitespace removed, so
`"To-Do"`, `"TODO"` and `"to do"` are one key. Unicode case folding is `toLowerCase()`; the table
carries no locale, and nothing here calls `localeCompare` (`AGENTS.md`).

| Target | Keys |
|---|---|
| `backlog` | `backlog`, `ideen`, `ideas`, `someday`, `irgendwann` |
| `todo` | `todo`, `to do`, `open`, `offen`, `neu`, `new`, `zu erledigen` |
| `in-progress` | `in progress`, `in arbeit`, `doing`, `wip`, `bearbeitung`, `in bearbeitung` |
| `done` | `done`, `erledigt`, `fertig`, `abgeschlossen`, `closed`, `geschlossen` |

The table is matched, not translated: it holds both languages at once, so a mixed setup (a German
Deck next to an English OpenProject) needs no configuration. It is **not** gettext — a catalogue
changes with the reader's locale, and the stack titles on a server do not.

### 4. User rules are exceptions, per board, and they win

A board may carry overrides: `sourceColumn` → target, by the same normalised key. An override
applies before every default rule including the source's own facts, because a person who says "our
'Done' stack is really a waiting lane" knows their board better than this table does. Overrides are
configuration (so CLI, GUI and MCP agree) and an override naming an unknown target is a
`ConfigError` at load, never a silently ignored line.

### 5. "Mine" is part of the query, not a filter on the view

```ts
type MineFilter = 'assigned' | 'watching' | 'all';
```

`assigned` is the default: cards assigned to the person (`SourceUser.isMe`). `watching` widens it to
cards they watch where the source has that notion. `all` is every card of the board.

It travels in `CardQuery` **to the source**, so OpenProject's `assignee = me` filter runs on the
server and only the relevant page crosses the wire — a view-side filter would fetch a whole instance
to throw most of it away. A source that cannot filter applies the same rule locally, on the same
core function, so the answer does not depend on which source it came from.

`watchedByMe: null` means the source has no watching concept (ADR 0007 §3). Under `watching` such a
card is included if it is assigned and excluded otherwise — `null` never reads as "yes", and never
silently narrows `assigned`.

### 6. The card keeps showing its original column

Every card displays `sourceColumn` next to its lane. Mapping is a view aid; the person still has to
recognise the card when they open it in Deck. It also makes a wrong rule visible instead of
mysterious: a card in "Todo" labelled "Review" is an override waiting to be written.

## Consequences

- One pure module decides lanes, with a table test per source type in German and English. No adapter
  and no frontend maps a column.
- A new source type adds a row to the default table and a case to the test; the name table is shared
  and grows for all of them at once.
- The setup flow needs a step for unassigned columns, and the board view needs a lane for them. A
  board can be used before that step is done.
- Adding a language to the name table is a code change with a test, not a translation. Someone whose
  columns are in neither language writes overrides, once per board.
- `ignore` hides cards. The count the view shows is of what it draws, and the setup has to say which
  columns are ignored, or cards vanish without explanation.
