---
'autotel': patch
'autotel-edge': patch
'autotel-cloudflare': patch
'autotel-adapters': minor
'autotel-mcp': patch
'autotel-cli': patch
---

- `autotel-adapters/next` adds `withAutotelAction(name, action)` for server actions: span `action.<name>`, no HTTP fields, `useLogger()` inside, one wide event per call, and `redirect()`/`notFound()` as non-errors. `withAutotel()` reads its first argument as the request when it has a `url` and `headers`.
- Cloudflare native tracing uses `span.spanContext()`, `setStatus()` and `updateName()`. `ctx.traceId` and `ctx.spanId` carry the ids Workers Observability shows, and `ctx.correlationId` derives from the trace id, with the `cf-ray` id as the fallback. `recordException` passes strings and `{ code, message }` objects through to the runtime.
- `log.error()` reaches Cloudflare Workers Issues once per error: through the native span's exception, or through `console.error` when the span cannot record one natively (OTLP mode, traces off).
- `log.set()` copies plain objects into the request context, so later calls leave the caller's objects untouched. A `Date` or class instance replaces the previous value, cycles are cut, and a `__proto__` key stays out of `Object.prototype`. The same applies to the edge execution logger and to `defineEnricher`.
- Redaction: the email and JWT patterns run in linear time, the email pattern leaves pnpm store paths such as `foo@1.2.3` alone, and bearer tokens and IBANs mask whole before the card and JWT patterns run.
- `autotel-mcp` retries a 408 from a backend, as it does a 429.
- `autotel --version` and `autotel schema` report the installed `autotel-cli` version, read from its `package.json`.
