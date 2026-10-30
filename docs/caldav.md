# CalDAV backend

`"backend": "caldav"` serves events and reminders from any CalDAV server through
[`@gjsify/dav`](https://www.npmjs.com/package/@gjsify/dav). Example:
[config.caldav.example.json](../config.caldav.example.json).

- `caldav.url`: server root or any URL you know; discovery (RFC 6764) finds the calendar home.
- `caldav.username`, `caldav.auth` (`basic`; `oauth2` is reserved and refused with an
  "authentication is not supported yet" error).
- The password is never in the file (a `password` key is a config error). Export it in the variable
  named by `caldav.passwordEnv`, default `REMINDER_CALDAV_PASSWORD`.
- A calendar's uid is its collection URL: `reminder calendars` prints the targets for grants,
  routes and defaults. VEVENT collections are events, VTODO collections are reminders.
- Writes need a grant exactly as with EDS. Creates use `If-None-Match: *`, so an existing UID is
  never overwritten.
- An update is a `PUT` with `If-Match` set to the etag the preceding read returned. If another
  client changed the task in between, the server answers `412` and the call fails with a
  `ConflictError` — re-read and retry rather than overwrite. Because a CalDAV UID is not its
  resource URL, `updateItem` looks the resource up again (one `REPORT` on the collection) before
  the `PUT`; the etag still comes from the original read, so the extra lookup cannot widen the
  window.
- A collection that refuses the write (`403`) surfaces as a read-only `BackendError`.
- A 401 surfaces as `BackendAuthError`. Recurring events come back as their series definition.

Not yet: OAuth (Google, Microsoft), delta sync.
