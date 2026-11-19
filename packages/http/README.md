# @gjsify/http-client

A small JSON-over-HTTP client for REST adapters (Nextcloud Deck, OpenProject, Zenkit). Plain
`fetch`, so it runs on GJS (gjsify's Soup fetch) and Node. MIT, incubating in reminder under its
final name ([ADR 0016](../../docs/adr/0016-gjsify-pim-incubates-here.md),
[ADR 0019](../../docs/adr/0019-http-client-is-its-own-package.md)); it moves to gjsify unchanged.

## API

```ts
import { HttpClient, paginateAll } from '@gjsify/http-client';

const client = new HttpClient({
  baseUrl: 'https://cloud.example.org/index.php/apps/deck/api/v1.1/',
  auth: { type: 'app-password', username: 'user@example.org', password }, // or basic / bearer
});
const result = await client.getJson<Board[]>('boards', { etag }); // ok | unchanged (304)
const cards = await paginateAll<Card>(client, 'cards', { style: 'offset', pageSize: 50 });
```

- `HttpClient`: base URL, auth (basic, app-password, bearer, or a named header), per-request `timeoutMs` (AbortController), `getJson` with
  `If-None-Match`; a 304 returns `{ status: 'unchanged' }`.  `postJson` sends a JSON body (query-style POSTs; no ETag).
- Errors extend `@gjsify/pim`'s `BackendError` (`domain: 'http'`, status in `code`):
  `UnauthorizedError` (a `BackendAuthError`), `ForbiddenError`, `NotFoundError`,
  `RateLimitedError` (`retryAfterMs` from `Retry-After`), `ServerError`, `TimeoutError`,
  `NetworkError`, `ResponseFormatError`. `@reminder/core`'s `classifyFetchError` reads them as is.
- `paginate` / `paginateAll`: `Link: rel="next"` (never leaves the origin) and offset/pageSize,
  with a page cap.
- `HostLimiter`: per-host concurrency (default 2) and optional minimum interval.
- Credentials never appear in messages, `toJSON`, or URLs; a request off the base origin is refused.

## What it does not do

No retries (a 401/403 is a decision, a 429/timeout is the sync service's schedule), no writes yet,
no robots.txt or compliance gate.

## Decision: troedler's client is not reused

`projects/troedler/packages/http` is a crawler client: robots.txt gate, a fixed honest user agent,
a hard per-run request budget, a 2 s politeness floor, error classes of `@troedler/core`, German
messages, `ProviderError` kinds. Those are policy for other people's websites; REST adapters call a
server the user owns an account on. Nothing there maps onto `BackendError` or ETag/304, so the
overlap is only the pattern: a single request path, a per-host promise queue, and an honest
Accept-Encoding without `br`, all of which this package re-implements in about 300 lines.

Now in this package: everything above. Later in gjsify: this package as a whole (`@gjsify/http`
is not taken, the name is `@gjsify/http-client` to stay clear of the Node `http` polyfill),
after Deck, OpenProject and Zenkit have exercised it. Possible later: write methods,
`If-Modified-Since`. troedler may switch to it for its API hosts once it is in gjsify.
