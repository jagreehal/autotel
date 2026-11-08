---
'autotel': minor
'autotel-web': minor
---

Tie a request rejected before routing to its session and user.

- **autotel**: an HTTP server span that fails (4xx other than 404, or 5xx) before any route was recorded, such as a 401 from auth middleware, is named from its path with ids replaced (`GET /users/:id/clients`) and carries `url.template`; `http.route` stays unset. Successes and 404s without a route keep `METHOD`. Express route handlers keep their span again (`ignoreLayersType` now defaults to `['middleware']`): an ignored layer records no exception, so a handler's thrown error was missing from the trace. Use `requestCtx` for request-wide attributes set inside a handler. In development, a span dropped by its own `trace()` sampler while its parent is exported warns once that the trace is incomplete.
- **autotel-web**: `identify(userId, attributes?)` and `clearIdentity()` tag every later span, log and event with `user.id`. `session: { propagate: true }` sends `session.id` in the `baggage` header (same-origin plus `baggage.allowedOrigins`), so with `init({ baggage: '' })` the API's server spans carry it. Full mode now sends baggage on XHR (axios), not only on `fetch`.
