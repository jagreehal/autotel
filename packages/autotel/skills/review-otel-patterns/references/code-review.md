# OpenTelemetry code review checklist

Run through this list when adding observability to a new service or auditing an existing one.

## Setup

- [ ] **Service name set.** `service.name` resource attribute is unique per deployable unit (not just `"app"`).
- [ ] **OTLP endpoint configured** via `OTLP_ENDPOINT` env var. Don't hard-code per-vendor URLs.
- [ ] **No global SDK init in handlers.** Init runs once at module load (Next.js `instrumentation.ts`, Workers top of module, Node `--require`).
- [ ] **Production redaction on.** `attributeRedactor: 'default'` (or `'strict'` / `'pci-dss'`) — autotel turns it on automatically when `NODE_ENV === 'production'`.
- [ ] **Sampling configured.** Don't ship 100% in production unless volume is genuinely tiny. `sampling.rates: { server: 25 }` is a reasonable starting point.

## Spans

- [ ] **One wide span per logical unit of work.** Avoid hundreds of trivial spans.
- [ ] **Span names are low-cardinality.** `/users/:id`, not `/users/123`. Use `SpanNameNormalizingProcessor` if necessary.
- [ ] **No raw bodies in attributes.** Pick fields explicitly: `{ user: { id, plan } }` not `{ user: requestBody }`.
- [ ] **Status is set on errors.** `createStructuredError` does it; manual throws should set `span.status = ERROR`.
- [ ] **Context propagation works end-to-end.** W3C `traceparent` headers on outbound requests (autotel's global fetch instrumentation handles this).
- [ ] **Cross-service propagation works.** Browser → server, server → service, server → queue worker.

## Cloudflare Workers

- [ ] **`defineWorkerFetch` (or `wrapModule`).** Async drains drop silently if `ctx.waitUntil` isn't wired.
- [ ] **No SDK calls inside `addEventListener`.** Use the module worker style.
- [ ] **Bindings instrumented.** `instrumentBindings: true` to get spans for KV / R2 / D1 / Service Bindings.
- [ ] **Durable Objects wrapped.** `wrapDurableObject` for transactional state.

## Logs (structured events)

- [ ] **`useLogger().set({ … })` instead of `console.log`.** Logger fields land on the active span automatically.
- [ ] **No PII in attributes** (or rely on redactor). Don't log raw email / cards / phones / JWTs.
- [ ] **Group fields with objects.** `{ user: { id, plan } }`, not flat `userId` / `userPlan`.
- [ ] **Decisions captured.** Which branch, which fallback, which feature flag — not just inputs.
- [ ] **Background work uses `log.fork()`** — gets its own span and `_parentCorrelationId` for correlation.

## Errors

- [ ] **`createStructuredError({ message, status, why, fix })`.** No bare `new Error('…')`.
- [ ] **`parseError()` at HTTP boundaries.** `internal` is stripped; clients only see safe fields.
- [ ] **Validation errors include `details`.** Per-field problems for the client to render.
- [ ] **No double-logging.** Don't `console.error(e); throw e`; the span will pick it up.

## Metrics

- [ ] **Use OTel meter API**, not service-specific clients.
- [ ] **Counters for events, histograms for durations, gauges for snapshots** — match the right type.
- [ ] **Bounded label cardinality.** Don't put `userId` on a metric label.

## AI / LLM

- [ ] **`withAiTelemetry()` from `autotel-edge`.** Captures `gen_ai.*` semantic attributes automatically.
- [ ] **No bespoke `ai.tokens` attributes.** Use `gen_ai.usage.input_tokens`, etc.
- [ ] **Cost tracking via the `cost` option** — outputs `gen_ai.cost.usd` on the span.
- [ ] **Tool-call spans enabled.** `experimental_telemetry: { isEnabled: true }`.

## Testing

- [ ] **`InMemorySpanExporter` in unit tests.** Assert spans + attributes.
- [ ] **`autotel-vitest` matchers** (`toContainSpan`, `withSpans()`).
- [ ] **One e2e smoke test against a real OTLP backend.** `pnpm test:e2e` template ships in `packages/autotel/test/e2e/`.
- [ ] **Bundle-size baseline.** `pnpm bundle-size` runs on PRs; commit the baseline only on intentional growth.

## Pipeline / processors

- [ ] **One source of composition.** `composeSpanProcessors` / `composeSubscribers` / `composePostProcessors` over hand-rolled tee logic.
- [ ] **Tail sampling for noisy services.** Keep errors + slow + a sampled %.
- [ ] **Filter health checks.** `FilteringSpanProcessor({ exclude: ['/healthz', '/ready'] })`.
- [ ] **Baggage for cross-cutting context.** `BaggageSpanProcessor` lifts `feature_flags`, `tenant`, etc. onto every span automatically.

## Secrets

- [ ] **No exporter tokens in client bundles.** Server-only env vars.
- [ ] **No span attributes containing secrets.** Even with redaction on, prefer not to capture them at all.
- [ ] **CI runs e2e with secret-protected workflow** (label `e2e`, never on fork PRs).
