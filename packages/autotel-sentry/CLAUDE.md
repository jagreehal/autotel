# autotel-sentry (Sentry OTLP Helpers)

Two entries. The root parses a Sentry DSN into the OTLP endpoint and auth headers Autotel's `init()` expects. `autotel-sentry/browser` joins autotel-web's traces to the Sentry browser SDK already on the page.

## Your Role

You are working on the Sentry integration package. You understand Sentry DSN format, Sentry's OTLP export configuration, and the Sentry browser SDK's event pipeline. The root entry has no runtime dependencies and calls no Sentry API. The browser entry reads the Sentry SDK structurally and imports no `@sentry/*` package.

## Tech Stack

- **Runtime**: Node.js 22+
- **Language**: TypeScript 5.0+ (ESM-first, CJS fallback)
- **Build**: tsup
- **Testing**: vitest
- **Key Dependencies**: none. The package is string and URL handling.

## Key Concepts

- **OTLP Configuration**: `sentryOtlpConfig(dsn)` parses a Sentry DSN into `{ dsn, endpoint, headers }` so Autotel's `init()` can export traces directly to Sentry's OTLP endpoint. No custom span processor is needed.
- **Ownership Split**: Autotel owns OTel setup and trace export. Sentry SDK handles error capture only. `@sentry/node` 11 leaves OTel alone by default (`enableOpenTelemetrySetup: false`); on 8–10 `skipOpenTelemetrySetup: true` is required so the Sentry SDK does not register a second OTel SDK. Do not put `skipOpenTelemetrySetup` in code targeting 11: it is no longer in the type, so it fails type-checking.
- **Error linking is one Sentry call**: without its own OTel setup, `@sentry/node` keeps its own scope trace ids, so a captured error starts a trace of its own. `Sentry.setOpenTelemetryContextAsyncContextStrategy()` after `Sentry.init()` makes it read the active OTel span instead (checked against `@sentry/node` 11.8 and a live Sentry project). It is Sentry's public API, so it stays a line in user code: a `linkSentryErrors()` export was removed in 0.7.0. Do not reintroduce it.
- **Overlap with Sentry**: `otlpIntegration` (`@sentry/node-core/light/otlp`, since 10.47.0) does both jobs. It defaults to installing its own exporter, which double-exports when autotel already exports. Pair it with `setupOtlpTracesExporter: false` or use this package, never both.

## Browser join (`autotel-sentry/browser`)

- **Why the browser needs code and Node does not.** On Node, Sentry has a public API for reading the active OTel span (`setOpenTelemetryContextAsyncContextStrategy`), so linking is one line of user code. `@sentry/browser` 11.9 has no equivalent: `registerExternalPropagationContext` exists in `@sentry/core` but is not exported from the browser SDK, and the browser has no AsyncLocalStorage, so the active span is gone after the first `await` anyway. `joinSentry` fills that gap with `Sentry.addEventProcessor` plus `currentSpanContext()` from `autotel-web/join`.
- **`joinSentry(Sentry, options)`** returns an `enrichSpans()` processor for `initFull({ spanEnrichers })` (an enricher, never a pipeline: `spanProcessor` replaces the export). Spans get `user.id` from the isolation scope (never the email) and `sentry.replay_id` (Sentry's own attribute name, from `@sentry/conventions`) only while replay is in `session` mode. Sentry itself only puts `replay_id` on the DSC in `session` mode; a buffered replay is kept only when Sentry captures an error. With `replayUrl`, failed spans also get `session.replay.url`.
- **Event processor.** Global processors run after Sentry applies its scope's random propagation trace id (`prepareEvent`), and `client.js` keeps an existing `contexts.trace`. So the processor **assigns** `trace_id`/`span_id` and drops Sentry's `parent_span_id`, unless `Sentry.getActiveSpan()` returns a span (Sentry's own tracer is running and knows better), or the event's `trace_id` is not Sentry's own scope propagation id: then the caller passed it (`captureException(error, { contexts: { trace } })`, the documented escape hatch) and it is kept, with `trace_url` added. Never infer over a supplied trace: by capture time another trace may be in flight. It skips transactions, and skips when more than one trace is in flight. Installed once per SDK object (`WeakSet`).
- **`sentryOtlpConfig().browserEndpoint`** carries the key as `?sentry_key=`, because the browser exporter sends no custom headers and `sendBeacon` cannot. Verified: Sentry's OTLP endpoint answers CORS preflight with `access-control-allow-origin: *` and accepts query-string auth.
- **Structural type, contract-tested.** `SentryLike` is hand-written so it accepts `@sentry/browser`, `@sentry/react`, `@sentry/nextjs` and the CDN bundle alike; `browser.contract.test.ts` assigns the real `@sentry/browser` to it and runs the join through Sentry's real pipeline with a capturing transport.
- **Two tracers.** If Sentry's `BrowserTracing` integration is on, it warns once: two tracers put two trace headers on each fetch.

## Entry Points

- `autotel-sentry`: `sentryOtlpConfig`, `SentryOtlpConfig` (no dependencies, Node and browser)
- `autotel-sentry/browser`: `joinSentry`, `SentryLike`, plus `sentryOtlpConfig` re-exported. Optional peers: `autotel-web`, `@opentelemetry/sdk-trace-base`

## Commands

```bash
# In packages/autotel-sentry directory
pnpm test               # DSN parsing, the browser join, and its contract against @sentry/browser
pnpm build              # Build package
pnpm lint               # Lint package
pnpm type-check         # TypeScript type checking
```

## File Structure

```
src/
├── index.ts                 — Root exports
├── types.ts                 — SentryOtlpConfig interface
├── config.ts                — sentryOtlpConfig() implementation
├── config.test.ts           — DSN parsing
├── browser.ts               — autotel-sentry/browser: joinSentry
├── browser.test.ts          — the join against a fake SDK
└── browser.contract.test.ts — the join against the real @sentry/browser
```

## Code Patterns

### DSN Parsing (config.ts)

Parse the Sentry DSN URL to derive the OTLP endpoint and auth header:

```typescript
export function sentryOtlpConfig(dsn: string): SentryOtlpConfig {
  // Parse DSN, build OTLP endpoint from host + project ID
  // Return { dsn, endpoint, headers: { 'x-sentry-auth': '...' } }
}
```

## Boundaries

- Always do: Validate DSN input and throw clearly, keep the root entry dependency-free, guard every Sentry SDK call
- Ask first: Changing the OTLP endpoint derivation logic, adding new exports
- Never do: Add a Sentry dependency (types are structural), register a Propagator or a pipeline SpanProcessor, create the OTel TracerProvider (Autotel owns that), reintroduce a Node error-linking helper (Sentry's own API covers Node), stamp `sentry.replay_id` from a buffered replay, overwrite `contexts.trace` while Sentry has an active span

## Testing

- `config.test.ts`: DSN parsing, malformed input, header shape, browser endpoint.
- `browser.test.ts` / `browser.contract.test.ts`: the browser join, the second against the real SDK.
- Live: `apps/example-sentry` `pnpm smoke:web` drives headless Chrome and reads the error and spans back from the Sentry API.

## Integration Requirements

**Prerequisites for users:**

1. `@sentry/node` must be installed (by the user; this package does not depend on it)
2. Call `sentryOtlpConfig(dsn)` before either `Sentry.init()` or `init()`
3. Leave OTel to autotel: `@sentry/node` 11 does by default (`enableOpenTelemetrySetup: false`; the old `skipOpenTelemetrySetup` is gone from its types). On 8–10 pass `skipOpenTelemetrySetup: true`
4. Call `Sentry.setOpenTelemetryContextAsyncContextStrategy()` after `Sentry.init()` so captured errors join the active trace

**Minimal setup:**

```typescript
import * as Sentry from '@sentry/node';
import { init } from 'autotel';
import { sentryOtlpConfig } from 'autotel-sentry';

const config = sentryOtlpConfig(process.env.SENTRY_DSN!);

Sentry.init({ dsn: config.dsn });
Sentry.setOpenTelemetryContextAsyncContextStrategy();
init({ service: 'my-app', endpoint: config.endpoint, headers: config.headers });
```

## References

- [Sentry OTLP Integration spec](https://develop.sentry.dev/sdk/telemetry/traces/otlp/): protocol this package targets
- [Sentry OTLP docs](https://docs.sentry.io/concepts/otlp/): Sentry-side configuration
