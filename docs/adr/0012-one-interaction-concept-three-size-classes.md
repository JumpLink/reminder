# 0012 — One interaction concept, three size classes

- **Status:** accepted
- **Date:** 2026-11-18

## Context

The UI (ADR 0004) has to work in a narrow desktop window, a normal one and a wide one, and later on
a phone. Building a layout per device means building every view several times, and the views drift.
The same content should appear at every width; only the container around it should change.

## Decision

### 1. Content is built once, the container switches

Every view and every detail pane is built once. What changes with width is the container that holds
it. Three size classes, measured in `sp` (not `px`) so they follow the user's text scale:

| Class | Width |
|---|---|
| compact | < 600 sp |
| medium | 600–1023 sp |
| wide | ≥ 1024 sp |

The thresholds live in **one** constants file in the GUI frontend and are checked by a breakpoint
check in the gate. Only one rung of the ladder applies at a time, and each rung sets everything it
needs; a rung never relies on an earlier one having set something.

### 2. Three things exist in every class

| Element | compact | medium | wide |
|---|---|---|---|
| view switcher (tasks · board · calendar) | bar at the bottom | switcher in the header | switcher in the header |
| source overview (sources on/off) | bottom sheet | overlay sidebar | docked sidebar |
| detail (task, card, event) | bottom sheet | dialog | inspector on the right |
| main action ("New") | `+` in the header | `+` in the header | `+` in the header, plus a quick-entry row |

The compact column is the phone layout, and it is also what a narrow desktop window shows. A phone
needs no separate interaction concept.

### 3. Widgets live in a package with no app dependency

Reusable widgets go in their own package that imports no `@reminder/*` package and uses no app
`_()`: text comes in as properties or from the package's own gettext domain, and data comes in as
plain interfaces (a board card receives `{ title, badges, due, avatars }`, not a core type). The
mapping from core data to widget data lives in the GUI frontend.

Each widget is written so it can move out of this repository: it is a candidate for gjsify.
Anything that is not specific to this app is ported there rather than built a third time here.

### 4. Layout decisions are arithmetic

Every layout rule (how many columns at which width, when overflow collapses into "+N more") is a
function of numbers in a file without `gi://`, tested on numbers. Widgets draw the answer.

## Consequences

- Adding a view means building its content once and checking it in three containers, not designing
  three layouts.
- A package that is meant to leave the repository must carry a licence its target can accept from
  the first commit, or porting becomes a rewrite. That choice is made when the package is created.
- The widgets package cannot import core types. That costs a mapping layer and buys portability.
- Each widget gets a story for visual review.
