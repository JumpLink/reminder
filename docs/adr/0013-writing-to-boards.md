# 0013 — Writing to boards: three capabilities, a conflict check per source

- **Status:** accepted
- **Date:** 2026-11-20

## Context

[ADR 0007](0007-boardsource-as-a-second-port.md) §5 made every `BoardSource` read-only and said so
in the port: `describe()` answers `canWrite: false`, and writing to a board is its own decision. This
is that decision.

A board that only reads is a board a person has to leave to use. The move they want is the cheapest
one in the whole application — drag a card one lane to the right — and it is also the one write where
four sources disagree about everything: what a column is, what a version is, which target columns
are reachable at all, and what happens when someone else moved the same card a second earlier.

Three things constrain the answer.

[ADR 0001](0001-calendar-items-as-their-own-product.md) §4 and its 2026-10-30 amendment: a write is
granted per capability and **one exact target**, the check sits inside the function that writes, and
the MCP surface repeats it independently. A process permission ("may write boards") would turn every
board of every configured account into a target the moment one of them is wanted.

[ADR 0003](0003-managing-reminders-in-place.md): a change rewrites only the lines it touches and
refuses on a stale copy (`If-Match`, `ConflictError`) instead of overwriting a stranger's edit with
text computed from an old read. A board write is the same problem with four different version
mechanisms underneath.

[ADR 0008](0008-board-columns-and-mine.md): lanes are a **mapping**, in the core. A write goes the
other way through that mapping, and the way back is not a function — several source columns map onto
one lane, so "move to in-progress" has to name a source column, not a lane.

## Decision

### 1. Three capabilities, and the target is one board

```ts
const CAPABILITIES = [
  'calendar.create', 'reminder.create', 'reminder.update',
  'board.move', 'board.update', 'board.create',
] as const;
```

| Capability | What it allows |
|---|---|
| `board.move` | change the column of a card that exists, and its position inside a column |
| `board.update` | change the title or the due date of a card that exists |
| `board.create` | add a card to a column |

The grant target is **one board**, spelled `<source>:<board>` — the same string the `boards.columns`
keys already use (`"work:42"`) and the same `account:uid` shape
[ADR 0005](0005-several-accounts-in-one-configuration.md) gave every other target. `grants.ts`
rejects a wildcard, an empty target and an unknown capability at load, unchanged; a grant for a
source ("work") without a board is a `ConfigError`, not a grant that covers every board on it.

The three are separate because they are separately dangerous. Moving a card is reversible by moving
it back; creating one leaves litter on a board other people read. Someone who wants drag-and-drop
grants `board.move` and nothing else.

### 2. Nothing is granted implicitly by `canWrite`

`SourceInfo.canWrite` becomes true for the adapters that gain a write path. It stays what ADR 0007
§5 made it: a statement about the **adapter**, so the GUI can grey out what no code could do. It is
never a permission. A source with `canWrite: true` and no grant refuses every write, and the GUI
asks for the grant instead of hiding the card.

### 3. The checks live in `core/src/board/write.ts`, not in a frontend

```ts
moveCard(context, { ref, toColumn, position? }): Promise<Card>
updateCard(context, { ref, changes }): Promise<Card>
createCard(context, { source, board, column, title, due? }): Promise<Card>
```

Each one resolves the board from `ref`, calls `requireGrant(grants, capability, '<source>:<board>')`
and only then touches an adapter. There is no second path: the CLI, the GUI and the MCP tool all
call these. A frontend that checked the grant itself would be a fourth place for the rule to drift,
and the drift would be silent — exactly the failure the three independent checks of ADR 0001's
amendment exist to catch.

`toColumn` is a **source column**, verbatim, as `listColumns` reports it. A lane is not a write
target: ADR 0008 maps many columns onto four lanes, and inverting that would have the core pick one
of several "done" stacks on the person's behalf. The GUI's drop target therefore resolves to a
source column before it calls — for a lane with exactly one source column that is automatic, for a
lane with several the GUI asks once and remembers it as configuration (the same file ADR 0008 §4
already uses for the forward mapping).

### 4. One new method on the port, and it reports what it refused

```ts
interface BoardSource {
  // …as in ADR 0007
  writeCard?(write: CardWrite): Promise<Card>;
}
```

An adapter without `writeCard` is read-only and `canWrite: false` — there is no half-written source.
The contract test of ADR 0007 §7 gains a write half: a write with a stale `version` must raise
`ConflictError` and must not have written, a write to a column the source does not have must raise
`InputError`, and a successful write must return the card as the source has it afterwards, not the
card the caller hoped for.

The returned card is what the next read will show. An adapter that cannot answer that cheaply reads
the card back; it never echoes the input.

### 5. Conflict detection is per source, and it is never skipped

| Source | Version | On write | Conflict |
|---|---|---|---|
| `vtodo` | ETag (ADR 0003) | `PUT` with `If-Match: <etag>` | `412` → `ConflictError` |
| `openproject` | `lockVersion` | `PATCH` carrying `lockVersion` | `409` → `ConflictError` |
| `deck` | per-card `ETag` | read, compare, then `PUT` | changed between read and compare → `ConflictError` |
| `zenkit` | none | read, compare the field being changed, then write | field changed → `ConflictError` |

The first two are the source's own optimistic locking and are used as such: `Card.version` carries
`lockVersion` for OpenProject (already mapped in `openproject-source.ts`) and the ETag for VTODO,
opaque above the adapter, handed back exactly as it came.

The last two have no conditional write this ADR is willing to rely on, so they **compare before
writing**: fetch the card, check that the value about to be replaced is still the value the caller
saw, then write. That is a smaller window, not no window, and the ADR says so rather than pretending
otherwise — the alternative is a lost update nobody is told about, and on Deck the person at least
finds the card in the wrong stack rather than silently losing a title.

A caller that passes no version gets a refusal, not a blind write. `version: null` from a source
that has no version is the compare-before-write case above, not permission to overwrite.

**OpenProject also restricts which columns are reachable.** Its workflows allow only certain status
transitions per type and role, so the adapter asks
`GET work_packages/{id}/form` ([API docs](https://www.openproject.org/docs/api/endpoints/work-packages/)),
reads the allowed values for `status` out of the form's schema, and offers only those as target
columns. A move to a status the form does not allow is an `InputError` **before** the write, with
the allowed names in the message. Guessing from the global `/statuses` list would offer columns the
server rejects, once per board, forever.

### 6. What a write may not do

No delete, no archive, no assignee change, no label change, no comment, no description. ADR 0003
excluded deletion for reminders for the same reason it is excluded here: an agent or a GUI bug that
can only move a card is recoverable by hand, and `Card` (ADR 0007 §3) deliberately has no
description or comments, so a write path for them would need a model the board does not have.

`board.update` is title and due date only, because those are the two fields a person corrects while
looking at the board.

### 7. The GUI is optimistic, and the rollback shows the reason

The card moves in the view the moment it is dropped; the core call runs behind it. On success the
view takes the returned card. On a `ConflictError` the card goes **back to the lane it came from**
and a toast says that someone else changed it, with a refresh action — the board then shows what is
actually there. On a `GrantDeniedError` the card goes back and the message names the missing grant
and the board, so the next step is to write one line of configuration rather than to guess.

Rolling back to the remembered lane rather than to whatever the next read says keeps the view honest
while the refresh is in flight; a card that silently stays where it was dropped is a card the person
believes they moved.

### 8. The CLI writes one card at a time, by name

```
reminder board move <board> <card> <column> [--source <id>]
reminder board add  <board> <column> <title> [--due <when>]
reminder board set  <board> <card> [--title <text>] [--due <when>]
```

Same resolution as `reminder board cards` (ADR 0005: a broken account fails the whole command rather
than answering partially). `<column>` is a source column name, matched case-insensitively against
`listColumns`; an ambiguous or unknown name prints the available columns and exits non-zero. No
interactive picker and no bulk move: a loop over `move` is something the person wrote deliberately.

### 9. MCP exposes `cards_move` and nothing else

One write tool, `cards_move`, registered through `applyGrantGate` with
`requiresCapability('board.move')` and annotated `readOnlyHint: false, openWorldHint: false`, exactly
like the three existing write tools. The three independent checks of ADR 0001's amendment apply
unchanged:

1. **Registration** — no `board.move` grant, no tool in `tools/list`.
2. **Call** — the gate resolves `<source>:<board>` the way the action will and refuses any board the
   grants do not name exactly.
3. **Core** — `moveCard` checks the same grant again.

`cards_create` and `cards_update` are deliberately not on the MCP surface in this phase. An agent
that can move a card changes where work sits; an agent that can create cards adds work nobody asked
for, and the board is shared with other people. They can be added later by the same pattern once
moving has been lived with.

## Consequences

- `BoardSource` gains an optional method and the contract test gains a write half. A read-only
  adapter is still a complete adapter.
- ADR 0007 §5's `canWrite: false` is history for the adapters that implement `writeCard`; the flag
  keeps its meaning (what the code can do), and the grant keeps its (what it may do).
- Three capabilities multiply by the number of boards a person has. The setup flow has to make
  granting one board one click, or nobody will use the writes.
- Deck and Zenkit keep a lost-update window. A test per source pins the conflict case against the
  fake server, and the window is written down here rather than discovered later.
- Every source needs its allowed-transition story told once. OpenProject's is the form endpoint;
  Deck and Zenkit allow any column; VTODO allows the four RFC statuses of
  [ADR 0014](0014-the-internal-board-as-vtodo.md).
- The GUI needs a remembered answer for "which source column is this lane, on this board", which is
  new configuration next to ADR 0008 §4's overrides.
