/**
 * `@reminder/caldav` — the CalDAV backend. Plain `fetch` through `@gjsify/dav`, so one
 * implementation serves GJS and Node. Basic auth only; see `UnsupportedAuthError` for the rest.
 */

export { createCaldavBackend, type CaldavOptions } from './backend.ts';
