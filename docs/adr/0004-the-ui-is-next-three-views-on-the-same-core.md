# 0004 — The UI is next: three views on the same core

- **Status:** accepted
- **Date:** 2026-11-18
- **Supersedes:** [ADR 0001](0001-calendar-items-as-their-own-product.md) §7 ("CLI and MCP first, a UI later")

## Context

ADR 0001 §7 put a UI off: "A GNOME UI can come later on the same core." The core now reads, creates
and updates items, enforces grants and dedupes by source key (ADR 0001, 0003), and the CLI and the
MCP server prove that nothing in it assumes a terminal. "Later" has arrived.

The goal is one place for everything a person has to do, in three views: **tasks** (which doubles as
today's agenda), **board** (kanban across sources) and **calendar**. The CLI and the MCP server stay
fully supported; the UI is a third frontend, not a new app next to the old one.

## Decision

### 1. The GUI is a third frontend under `app/src/frontends/gui`

`app/` already picks a frontend at the yargs entrypoint (`cli`, `mcp`). The GUI joins them. It reads
and writes through the same `@reminder/core` functions as the other two; there is no second path to
a backend.

### 2. Every rule lives in the core, never in a frontend

Grants, dedupe, source-key handling, routing, column assignment, the "mine" filter and visibility
(ADR 0006) are decided in `@reminder/core`. A frontend presents and asks; it does not decide. A rule
implemented in the GUI is a rule the CLI and MCP do not have, which is how an agent ends up allowed
to do what the person's own window refuses, or the reverse.

### 3. Presentation logic is plain arithmetic, tested without GTK

Layout decisions (how many columns at which width, when "+3 more" appears) sit in files without a
`gi://` import and are tested on numbers. Widgets render the result.

### 4. The write-gate rules are unchanged

A GUI write passes the same grant check as an MCP write, inside the core. The GUI does not get a
looser rule because a person is looking at it. A new write capability is still an ADR (ADR 0001 §4).

## Consequences

- ADR 0001 §7 is history. The package layout in `AGENTS.md` gains the GUI frontend when the first
  GUI code lands, not before.
- Features are built for the core first and exposed in the GUI second. If the GUI needs a rule the
  core lacks, the core grows it.
- GUI-only state (window size, which views are hidden) is app settings, not configuration the CLI
  and MCP read (ADR 0006).
- The GUI adds toolkit dependencies to `app/` only. `@reminder/core` keeps `types: []`.
