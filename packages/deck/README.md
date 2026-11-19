# @reminder/deck

Nextcloud Deck as a read-only `BoardSource` ([ADR 0007](../../docs/adr/0007-boardsource-as-a-second-port.md)).

**Why `@reminder/*` (AGPL-3.0-or-later), not an incubating MIT `@gjsify/*` package:** it implements
the port `@reminder/core` owns and imports the core's `Card`, `filterMine` and `_()`. Only code that
does not know the app core may move to gjsify ([ADR 0016](../../docs/adr/0016-gjsify-pim-incubates-here.md)).
The transport is `@gjsify/http-client`, which is that generic part.

```ts
const source = createDeckBoardSource({
  baseUrl: 'https://cloud.example.org/',
  auth: { type: 'app-password', username: 'alice', password },
});
```

Options are a plain object; config parsing and registry wiring live in the app.

## Mapping

- Stack = column, in the server's `order`. Deck has no "finished" stack, so `closed` is null and
  `rules.ts` reads the title.
- `assignedUsers[].participant.uid` = assignee; `isMe` when it equals the uid from
  `ocs/v2.php/cloud/user` (or `identity.id`).
- No watching: `hasWatchers: false`, `watchedByMe: null`.
- Archived or done cards are `closed`; archived ones come from `stacks/archived`, only for `includeClosed`.
- Change token = ETag of `GET boards/{id}/stacks`. Deck folds card, label and assignment changes
  into it, so "unchanged" is one 304 request.
- Card link: `<base>/index.php/apps/deck/board/<b>/card/<c>`.
