# OpenTelemetry code review checklist

Run through this list when adding observability to a new service or auditing an existing one.

## Setup

- [ ] **Service name set.** `init({ service })` (required, or `OTEL_SERVICE_NAME`) is unique per deployable unit (not just `"app"`).
- [ ] **OTLP endpoint configured** via `OTEL_EXPORTER_OTLP_ENDPOINT` (a base URL; autotel appends `/v1/<signal>`). Don't hard-code per-vendor URLs. With no endpoint, nothing is exported.
- [ ] **No global SDK init in handlers.** Init runs once at module load (Next.js `instrumentation.ts`, Workers top of module, Node `--import`).
- [ ] **Production redaction on.** `attributeRedactor: 'default'` (or `'strict'` / `'pci-dss'`): autotel applies `'default'` automatically when unset and the environment (`environment` option, else `NODE_ENV`, else `'development'`) is `production`.
- [ ] **Sampling chosen deliberately.** With no `sampling` or `sampler`, nothing is dropped. Production sets `sampling: 'production'` (10% baseline, errors and slow traces always kept) explicitly; one-shot scripts and local runs leave it unset or use `'development'`.

## Spans

- [ ] **One wide span per logical unit of work.** Avoid hundreds of trivial spans.
- [ ] **Span names are low-cardinality.** `/users/:id`, not `/users/123`. Use `init({ spanNameNormalizer: 'rest-api' })` if necessary.
- [ ] **No raw bodies in attributes.** Pick fields explicitly: `{ user: { id, plan } }` not `{ user: requestBody }`.
- [ ] **Status is set on errors.** Throwing through `trace()` / an adapter does it; code that catches and swallows should call `log.error(err)` or `recordStructuredError(ctx, err)`.
- [ ] **Context propagation works end-to-end.** W3C `traceparent` headers on outbound requests. Node: `autoInstrumentations: ['http', 'undici']` (off unless set) or `injectTraceContext()` from `autotel/http`. Edge: global fetch is instrumented by default.
- [ ] **Cross-service propagation works.** Browser → server, server → service, server → queue worker.

## Cloudflare Workers

- [ ] **`defineWorkerFetch` (or `wrapModule`).** Async drains drop silently if `ctx.waitUntil` isn't wired.
- [ ] **No SDK calls inside `addEventListener`.** Use the module worker style.
- [ ] **Bindings instrumented.** Use the `env` the wrapped handler receives: `wrapModule` / `defineWorkerFetch` wrap its KV / R2 / D1 / Service Bindings automatically.
- [ ] **Durable Objects wrapped.** `wrapDurableObject` (or `instrumentDO`).

## Logs (structured events)

- [ ] **`getRequestLogger().set({ … })` instead of `console.log`.** Logger fields land on the active span automatically. Adapter code uses that adapter's `useLogger()`.
- [ ] **No PII in attributes** (or rely on redactor). Don't log raw email / cards / phones / JWTs.
- [ ] **Group fields with objects.** `{ user: { id, plan } }`, not flat `userId` / `userPlan`.
- [ ] **Decisions captured.** Which branch, which fallback, which feature flag: not just inputs.
- [ ] **Background work uses `log.fork()`**: gets its own span and `_parentCorrelationId` for correlation.

## Errors

- [ ] **`createStructuredError({ message, status, why, fix })`.** No bare `new Error('…')`.
- [ ] **`parseError()` at HTTP boundaries.** Return the parsed fields without `raw`; `internal` and `cause` are never included.
- [ ] **Validation errors include `details`.** Per-field problems for the client to render.
- [ ] **No double-logging.** Don't `console.error(e); throw e`; the span will pick it up.

## Metrics

- [ ] **Use OTel meter API**, not service-specific clients.
- [ ] **Counters for events, histograms for durations, gauges for snapshots**: match the right type.
- [ ] **Bounded label cardinality.** Don't put `userId` on a metric label.

## AI / LLM

- [ ] **AI SDK registers `autotelTelemetry()`.** `registerTelemetry(autotelTelemetry())` from `autotel-genai/observer` captures canonical `gen_ai.*`, tool spans, cost, and streaming timing.
- [ ] **No bespoke `ai.tokens` attributes.** Use `gen_ai.usage.input_tokens`, etc.
- [ ] **Cost tracking is canonical.** Use `gen_ai.usage.cost.usd`, not custom cost keys.
- [ ] **Tool-call spans are emitted by the integration.** No plain log-only tool activity.

## Testing

- [ ] **`createTraceCollector()` from `autotel/testing` in unit tests.** Assert spans + attributes (`expectSpan`, `assertTraceSucceeded`, `assertNoErrors`).
- [ ] **`autotel-vitest`** for a span per test (`test` fixture, `otelTestCollector`).
- [ ] **One e2e smoke test against a real OTLP backend.** autotel's own template lives in `packages/autotel/test/e2e/`.

## Pipeline / processors

- [ ] **One source of composition.** Node: `init({ destinations })`. Edge: `composeSpanProcessors` / `composeSubscribers` / `composePostProcessors` over hand-rolled tee logic.
- [ ] **Tail sampling for noisy services.** Keep errors + slow + a sampled % (`sampling: 'production'` in Node, `sampling.tailSampler` on edge).
- [ ] **Filter health checks.** `init({ spanFilter: (span) => !/^GET \/(healthz|ready)$/.test(span.name) })`.
- [ ] **Baggage for cross-cutting context.** `init({ baggage: true })` copies baggage entries onto every span as `baggage.*` attributes.

## Secrets

- [ ] **No exporter tokens in client bundles.** Server-only env vars.
- [ ] **No span attributes containing secrets.** Even with redaction on, prefer not to capture them at all.
- [ ] **CI runs e2e with secret-protected workflow** (label `e2e`, never on fork PRs).
