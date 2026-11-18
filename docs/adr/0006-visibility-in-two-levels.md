# 0006 — Visibility in two levels: disabled and hidden

- **Status:** accepted
- **Date:** 2026-11-18

## Context

A person with many sources — several calendars, task lists and boards — does not want all of them in
view all the time: a work source on a weekend, a shared list they only follow. Two different things
get called "turning a source off", and they differ in what they cost and who they affect:

- a source the person never wants this program to touch (no network traffic, nothing stored), and
- a source they only want out of the way in the window for now, while agents keep working with it.

One switch cannot mean both without either surprising an agent that lost a source because a window
was tidied, or leaving data on disk for a source the person believes is off.

## Decision

### 1. Two levels, two homes

| Level | Lives in | Applies to | Effect |
|---|---|---|---|
| **disabled** | the configuration file | every frontend: GUI, CLI, MCP | no fetch, no cache; an existing cache is **cleared when the source is disabled** |
| **hidden** | GUI app settings | the GUI only | the view does not show it; fetching, caching, CLI and MCP are unchanged |

### 2. Disabled means absent

A disabled source behaves as if it were not configured: it is not listed, not queried, not written
to, and no cache is created for it. Disabling removes what the cache already holds, so "off" can be
trusted to mean "nothing of it is stored here". Enabling it again fetches fresh.

### 3. Hidden is a view state

Hiding changes what the GUI draws. It does not stop synchronisation, does not clear the cache and
does not remove the source from CLI or MCP results. It is app settings, not configuration, because
no other frontend reads it.

### 4. Agents see every enabled source, hidden ones included

The MCP server and the CLI serve all **enabled** sources. A source the person hid in the window is
still visible to an agent, because hiding is about the person's screen, not about what an agent may
read. Access is governed by grants (ADR 0001 §4), not by what the window currently shows.

### 5. The rule lives in the core

"Which sources are enabled" is a core function every frontend calls. A frontend that filtered by
itself would drift from the others.

## Consequences

- Someone who wants an agent not to see a source disables it; hiding is not a privacy control and the
  GUI must say so where it offers the choice.
- The cache (a later ADR) never has to guess: its contents are exactly the enabled sources.
- Two switches per source in the settings UI, with wording that tells them apart.
- Clearing a cache on disable is a deliberate write to local derived data, and has to be safe to
  repeat.
