# @reminder/zenkit

Read-only Zenkit `BoardSource` for the reminder core. Plain options in (`createZenkitBoardSource`), no
config parsing, no registry wiring.

## Why an app package, not `@gjsify/*`

It implements the core's `BoardSource` port and imports `@reminder/core`. An MIT `@gjsify/*` package
may never import `@reminder/*` (ADR 0016/0019), so this stays AGPL-3.0-or-later and private, like
`@reminder/core`. The generic HTTP part lives in `@gjsify/http-client`.

## Mapping

- list → board; the values of one choice field → columns (in `sortOrder`); `closed`/`initial` are `null`
  (Zenkit has no such fact), so `rules.ts` classifies by name.
- persons field → assignees; no watchers (`hasWatchers: false`, `watchedByMe: null`).
- Per list (`lists: { <shortId|id|uuid>: { columnField, personField, labelField, dueField } }`) the fields
  are selectable by uuid, id, shortId or name. Default: first choice / first persons / next choice /
  first date field.

## Change detection

Zenkit has no ETags. A read with a token costs one `limit: 1` request sorted by `updated_at` desc; the
token is `query|updated_at|total`, so edits and removals both move it. If the server ignored the sort the
probe would differ and the answer is "changed" (safe direction).

## Unverified

The official API docs are not machine-readable; endpoint shapes and field keys follow the plan and
third-party clients. Verify against a real account before relying on them.
