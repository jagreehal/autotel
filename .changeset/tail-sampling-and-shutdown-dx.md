---
'autotel': minor
'autotel-aws': patch
---

**autotel**

- `init({ tailSampling: { traceTimeoutMs, maxBufferedSpans } })` sets the tail sampler's limits, so a long-running job keeps its whole trace until `shutdown()` decides it. When the buffer fills, the sampler decides the oldest trace on the spans it has once its root ends.
- `processHandlers` ends the spans still running on SIGTERM, SIGINT or a fatal error, with ERROR status and `error.type`. A stopped job exports its whole trace.
- `shutdown()` waits up to 10s for the SDK. Set the limit with `init({ shutdownTimeoutMs })` or `shutdown({ timeout })`.
- `requestCtx` in a batch job or queue consumer tags the local root `trace()` started, and it stays within one trace across `withNewContext()`.
- A process started with `TRACEPARENT` (and `TRACESTATE`, `BAGGAGE`) continues that trace. Opt out with `init({ traceContextFromEnv: false })`.
- `service.version` reads `SERVICE_VERSION`, `DD_VERSION`, `APP_VERSION` or the deployed commit before package.json. An explicit `version` and `OTEL_RESOURCE_ATTRIBUTES` take precedence.
- Metrics sent to a Datadog intake host use delta temporality. `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE` takes precedence.
- Default PII redaction matches the production environment in any letter case.
- `ctx.addLink()` and `ctx.addLinks()` accept `null` and `undefined`, so `createLinkFromHeaders()` passes straight in.

**autotel-aws**

- `autoInstrumentAWS()` finds the SDK's base Client beside each installed `@aws-sdk/client-*`, including pnpm's isolated installs and `@smithy/core/client` in current SDKs, patches each Smithy version in use, and forwards every argument to `send`.
