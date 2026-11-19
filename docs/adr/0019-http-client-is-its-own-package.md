# 0019 — `@gjsify/http-client`: one REST client for the board adapters, incubated here

- **Status:** accepted
- **Date:** 2026-11-19

## Context

Deck, OpenProject and Zenkit adapters need the same things: auth, ETag revalidation, typed errors
with `Retry-After`, timeouts, pagination, per-host limits. troedler has an HTTP client, but it is a
crawler gate (robots.txt, politeness floor, request budget, its own error classes).

## Decision

1. A new package `@gjsify/http-client`, MIT, under its final name (ADR 0016). `@gjsify/http` is
   avoided: gjsify ships the Node `http` polyfill under that name.
2. Its errors extend `@gjsify/pim`'s `BackendError`/`BackendAuthError` with `domain: 'http'`, so the
   sync classifier needs no second path. `classifyFetchError` reads `retryAfterMs` by shape.
3. troedler's code is not reused: its policy does not apply to authenticated REST calls and its
   errors do not map. Only the pattern (single request path, per-host queue) carries over.
4. No retries inside the client; backing off is the sync service's job (ADR 0017).
5. The package moves to gjsify as a whole once the three adapters have used it.

## Consequences

- The adapters depend on one small package; credentials are scrubbed in one place.
- troedler keeps its own client until it can adopt this one.
