# @reminder/openproject

A read-only [OpenProject](https://www.openproject.org/docs/api/) driver for the `BoardSource` port of
`@reminder/core` (docs/adr/0007): projects are boards, statuses are columns, work packages are cards.

## Why `@reminder/*` and AGPL, not an MIT `@gjsify/*` package

The adapter implements a port the core owns and imports its types (`BoardSource`, `Card`,
`boardNotFound`, `_()`), so it cannot move to gjsify without the core. The generic parts it uses —
the HTTP client and `paginate` — are already `@gjsify/http-client` (MIT, incubating).

## Use

```ts
import { createOpenProjectSource } from '@reminder/openproject';

const source = createOpenProjectSource({
  baseUrl: 'https://projects.example.org/',
  auth: apiKeyAuth(token), // Basic user `apikey`; { type: 'bearer', token } works too
});
```

The options are plain data: no config parsing, no registry wiring — that is the caller's job.

## How it maps

- **Boards**: `GET /api/v3/projects` (paginated). Web link `<base>/projects/<identifier>`.
- **Columns**: `GET /api/v3/statuses`; `isClosed` → `closed`, `isDefault` → `initial`, `position`.
  A card's `sourceColumn` is its status name, so `rules.ts` maps `isClosed` to the done lane.
- **Assignees**: `assignee` and `responsible`, both listed. `isMe` compares the user id with
  `/users/me`, never a name.
- **"Mine" = assigned**: filters are AND-combined by the server, so `assignee = me OR responsible = me`
  is two queries united and de-duplicated by work package id.
- **Watchers**: `watcher = me` is a third query; its ids set `watchedByMe`. `watching` unites all three.
- **Version / updated**: `lockVersion` and `updatedAt`. Web link `<base>/work_packages/<id>`.
- **Change detection**: the collection has no ETag. Per query one probe request
  (`pageSize=1`, sorted by `updatedAt` descending) yields `total` and the newest `updatedAt`; the
  token is those pairs joined. Unchanged → no work packages are fetched. A work package that merely
  left the query lowers `total`, so moves and deletions are noticed too.
- **Closed cards** are fetched only with `includeClosed`, without a time window (the server cannot
  express "open, or closed in the last 14 days" in AND-only filters).

Credentials live in `@gjsify/http-client` and never appear in errors.
