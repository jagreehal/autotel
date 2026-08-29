# Autotel: Guide for AI Coding Agents

This file is the **single source of truth** for AI coding assistants (Cursor, Claude Code, etc.) working in the Autotel repo or in codebases that use Autotel. Use it to suggest correct instrumentation, avoid anti-patterns, and keep changes consistent with project rules.

## Keeping This File Updated

Update this file when:

- **Recurring mistake**: The same error appears twice (wrong import path, wrong API, incorrect assumption) → add a note under the relevant section or a callout.
- **Maintainer guidance**: You're told to always/never do something or to follow a structural rule → capture it here so future sessions follow it.
- **New pattern**: A new convention is agreed on (naming, architecture, where to put new code) → document it under the right section.
- **Full refresh**: After a broad update (e.g. "align all examples with X"), add a short note on what was done and what invariant to maintain.

When updating, be specific and actionable. Prefer short, targeted notes.

## Philosophy

- **Write once, observe everywhere**: One instrumentation surface; many backends via OTLP.
- **Functional API**: Wrap handlers and functions with `trace()`, `span()`, `instrument()`; avoid manual span lifecycle where possible.
- **Structured errors**: Errors should carry `message`, `why`, `fix`, `link`, `status`, `code`, `cause`, `internal` (backend-only) so agents and users can diagnose and act.
- **Request context**: Use `getRequestLogger()` when you need one coherent snapshot per request (attributes + correlated log-based events).
- **Event model**: For new instrumentation, emit events through the Logs API model (correlated logs). Do not add new direct dependencies on `Span.addEvent` / `Span.recordException` in app-facing guidance.
- **GenAI/LLM**: All GenAI instrumentation lives in `autotel-genai` (not core `autotel`). Trace calls with `traceGenAI()` from `autotel-genai/trace` (names the span `"{operation} {model}"`, e.g. `chat gpt-4o`), record token usage with `recordGenAiUsage()`, costs via `autotel-genai/cost`, and emit events via `autotel-genai/events`. Always use the canonical `gen_ai.*` attribute namespace (e.g. `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.provider.name`, `gen_ai.usage.cost.usd`).
- **Agent audits**: For agentic workflows, prefer `autotel-genai/agent` for identity-bound audit metadata, delegated scope checks, session lifecycle, tool-call hashing, and bounded `decision.summary` evidence. Do not log raw reasoning traces or raw tool payloads.

### Cloudflare Direction

- For `autotel-cloudflare`, prefer one DX across Workers, Queues, Scheduled, Email, Durable Objects, alarms, and Workflows.
- Keep Cloudflare's trace call shapes aligned with core: every `trace(...)` form returns a wrapper (`trace(fn)`, `trace(name, fn)`, `trace(name)(fn)`), and `trace.run(name, ctx => result)` runs one named operation immediately. For reusable named Cloudflare business logic, use `withTracing({ name })((ctx) => fn)`; the package's `instrument(handler, config)` name is reserved for Worker handler instrumentation.
- Prefer span attributes plus one execution-scoped snapshot over scattered `logger.info(...)` calls in Cloudflare examples.
- If Cloudflare needs request-logger-style DX, implement it in `autotel-edge` first using edge-safe context primitives. Do not copy the Node `AsyncLocalStorage` implementation from core `autotel`.
- **Native tracing**: `trace()`/`span()`/`enterSpan()` auto-nest in Cloudflare's native trace waterfall when `observability.traces` is enabled (autotel detects `ctx.tracing`); it defers binding instrumentation + export to the platform and falls back to autotel's OTLP pipeline otherwise. The runtime-agnostic seam is in `autotel-edge` (`src/core/native-bridge.ts`); the CF adapter is in `autotel-cloudflare` (`src/native/native-tracing.ts`). Config: `nativeTracing: 'auto'|'on'|'off'`. Don't add CF imports to autotel-edge. See `docs/CLOUDFLARE-NATIVE-TRACING.md`.

---

## Quick Reference

| Command        | Description                              |
| -------------- | ---------------------------------------- |
| `pnpm build`   | Build all packages                       |
| `pnpm test`    | Run all tests                            |
| `pnpm lint`    | Lint all packages                        |
| `pnpm format`  | Format with Prettier                     |
| `pnpm quality` | Build + lint + format + typecheck + test |

**Agent Skills:** Skills live at the repo root under `skills/`, grouped into `core/`, `frameworks/`, `integrations/`, and `extending/` (build-your-own on the public extension points). They follow the open [Agent Skills specification](https://agentskills.io/specification). The [skills CLI](https://github.com/vercel-labs/skills) discovers `skills/<category>/<name>/SKILL.md` at the repo root, so consumers add them by name (`npx skills add jagreehal/autotel --skill autotel-tanstack`). Skills no longer ship inside the npm package tarballs; the repo-root layout is the single source of truth.

---

## Package Structure

```
autotel/
├── packages/
│   ├── autotel/              # Core: trace, span, init, events, request logger, structured error
│   ├── autotel-edge/         # Edge runtimes (fetch, AsyncLocalStorage, execution logger)
│   ├── autotel-cloudflare/   # Cloudflare Workers
│   ├── autotel-tanstack/      # TanStack Start
│   ├── autotel-hono/         # Hono middleware
│   ├── autotel-mcp-instrumentation/          # MCP instrumentation
│   ├── autotel-genai/         # GenAI/LLM: traceGenAI, cost, metrics, events, ai-sdk, mastra, agent governance (autotel-genai/agent)
│   ├── autotel-langfuse/      # Langfuse: langfuseCompatibility() enricher, langfuseScores(), langfuseMedia()
│   ├── autotel-posthog/       # PostHog join: joinPostHog() browser session/replay, PostHogSubscriber for server track()
│   ├── autotel-subscribers/   # Event subscribers (Mixpanel, Amplitude, Segment, Slack, Loki, file, webhooks)
│   ├── autotel-web/           # Browser SDK: traceparent + W3C baggage propagation (setBaggage)
│   ├── autotel-webmcp/        # Browser WebMCP tool registration/execution tracing
│   └── ...
├── docs/
│   ├── DEVELOPMENT.md
│   ├── ARCHITECTURE.md
│   ├── CONFIGURATION.md
│   └── AGENT-GUIDE.md        # Detailed review checklist, before/after examples
└── apps/                     # Example apps
```

Package-specific details: see each package’s `CLAUDE.md` (e.g. `packages/autotel/CLAUDE.md`).

---

## Core API (for suggesting user code)

When the user wants observability, suggest these entry points. All from `autotel` unless noted.

| Need                                       | API / entry point                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trace work                                 | `trace(fn)` / `trace(name, fn)` / `trace(name)(fn)` all wrap a reusable function; `trace.run(name, ctx => result)` runs one named operation immediately; read the span inside any traced body from the ambient `ctx` import; `instrument({ key, fn })` is the options form of the wrapper; `span(name, fn)` is the lower-level callback form                                                                                                                                                                                                                                           |
| Request-scoped attributes                  | `getRequestLogger(ctx?)` → `.set()`, `.setLevel()`, `.info()` / `.warn()` / `.error()`, `.emitNow()`, `.fork()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Structured throw                           | `createStructuredError({ message, why?, fix?, link?, status?, code?, cause? })`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Parse API errors (client)                  | `parseError(err)` → `{ message, status, why?, fix?, link?, raw }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Lock init (framework)                      | `lockLogger()`, `isLoggerLocked()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Product/analytics events                   | `track(name, attributes)` or `Event` from `autotel/event`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Observable input validation                | `defineValidator(name, schema, { boundary, onMismatch })` from `autotel/validate`: records Zod/`safeParse` mismatches as `validation.*` spans + `autotel.validation.mismatches` counter. `reject` (default) records then throws a 400; `observe` records then returns raw input. PII-safe (paths/codes only). Security escalation is explicit opt-in via `onValidationMismatch()`. Not the same as `autotel-schema` (telemetry-surface contract)                                                                                                                                       |
| Init (once at startup)                     | `init({ service, ... })` from `autotel` or `autotel/instrumentation`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| PII redaction                              | `init({ attributeRedactor: 'default' \| 'strict' \| 'pci-dss' \| { keyPatterns, valuePatterns } })`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Testing                                    | `createTraceCollector()` or `createMemoryExporter()` from `autotel/testing`; `InMemorySpanExporter` from `autotel/exporters`. `createMemoryExporter()` collects finished spans as plain objects (`name`, `traceId`, `parentSpanId`, `durationMs`, `attributes`, `status`) with `findSpan(name)` / `findSpans(name)` / `reset()`: reach for it instead of hand-writing a `SpanExporter` against the OpenTelemetry SDK types.                                                                                                                                                            |
| Service level objectives                   | `createSloTracker()` and `evaluateBurnRateAlert()` from `autotel/slo`: rolling good/bad SLI calculation, error-budget consumption, baseline/lookahead forecasts, and dual-window burn-rate decisions. Keep SLO names and metric attributes low-cardinality.                                                                                                                                                                                                                                                                                                                            |
| Cohort analysis (debug loop)               | `compareCohorts({ outlier, baseline })` from `autotel/analysis`: ranks the field/value pairs separating a group you are investigating from a normal population. Accepts wide events, `TestSpan.attributes`, or backend rows. Skips fields whose values never repeat, so bucket numeric fields at instrumentation time. Output is a hypothesis; confirm it against individual traces.                                                                                                                                                                                                   |
| Name an experiment                         | `experiment({ name, variant, expect? })` from `autotel`: stamps `experiment.name` / `experiment.variant` / `experiment.expectation` on the active span and writes the first two to baggage, so child spans started afterwards and the services the request goes on to reach carry the same answer (needs `init({ baggage: '' })` for the bare keys; `baggage: true` prefixes them). The two cohorts you want to compare are then selectable from telemetry rather than reconstructed by hand. Ambient: call it at any depth inside a traced body. No-ops when nothing is being traced. |
| Bucket a numeric attribute                 | `bucket(value, boundaries)` from `autotel/analysis`: turns a raw duration or byte count into a low-cardinality label (`100-500`). `compareCohorts` skips fields whose values never repeat, so bucket at instrumentation time or the field can never describe a cohort. Non-finite values and an empty boundary list both give `'unknown'` rather than a bucket that never happened.                                                                                                                                                                                                    |
| Keep a trace whatever the sampler says     | `forceKeep()` from `autotel`: sets the tail-keep attributes **and** marks the span, because the tracing wrapper writes the sampler's verdict after the body runs and would otherwise overwrite the override. `forceKeepAuditEvent()` in `autotel-audit` delegates to it.                                                                                                                                                                                                                                                                                                               |
| Full fidelity for one request, no deploy   | Baggage key `autotel.debug` (`AUTOTEL_DEBUG_BAGGAGE_KEY` from `autotel`). A request carrying it keeps its trace whatever the sampler decides, and because baggage propagates, it follows that request across every service. Set it at a gateway, a proxy, a feature flag or a `curl`. This is the alternative to shipping a log line to recover detail you already threw away.                                                                                                                                                                                                         |
| Security observability hooks (OWASP A09)   | Observability at security decision points: `securityEvent()` / `withSecurity()` / `hashIdentifier()` from `autotel-audit`; zero-code signals via `createSecuritySignalProcessor()` in `init({ spanProcessors })`. See `docs/SECURITY-OBSERVABILITY.md` and `integrations/security` in apps/docs.                                                                                                                                                                                                                                                                                       |
| GenAI/LLM calls                            | `traceGenAI()` (alias `traceLLM`) from `autotel-genai/trace`; pair with `recordGenAiResponse()`, `recordGenAiUsage()`, `setGenAiContent()`. Cost via `recordLLMCost`/`estimateLLMCost`/`MODEL_PRICING` from `autotel-genai/cost`; events via `recordInferenceDetails()`/`recordEvaluationResult()` from `autotel-genai/events`; metrics via `genAiMetricViews` from `autotel-genai/metrics`. Canonical `gen_ai.*` attributes only                                                                                                                                                      |
| Agent identity + auditability              | `withAgentAction()`, `withAgentSession()`, `withScopedTool()`, `recordPolicyDecision()`, `recordDecisionBasis()`, `createAgentIdentityRegistry()`, `createSignedEventEnvelope()` from `autotel-genai/agent`                                                                                                                                                                                                                                                                                                                                                                            |
| Agent security observability (Google SAIF) | `recordControllerId()`, `recordHumanApproval()`, `recordInputProvenance()`, `recordPlanStep()`, `recordPlanRiskAssessment()`, `runAgentPlanClassifier()`, `heuristicPlanRiskClassifier()` from `autotel-genai/agent`; MCP bridge via `createMcpSecurityEventBridge()` from `autotel-audit`; passive chain detection via `createSecuritySignalProcessor()`. See [`docs/AGENT-SECURITY-OBSERVABILITY.md`](docs/AGENT-SECURITY-OBSERVABILITY.md).                                                                                                                                         |
| PostHog session / replay join              | `joinPostHog(posthog)` from `autotel-posthog` in `initFull({ spanEnrichers })`. Stamps `session.id` / `user.id` on spans, `$trace_id` on PostHog events, and copies session id onto same-origin fetches as baggage. Server `track()`: `PostHogSubscriber` from `autotel-posthog/subscriber`.                                                                                                                                                                                                                                                                                           |

- **Request logger** requires an active span (or explicit `TraceContext`). So wrap HTTP handlers with `trace()` (or framework middleware that creates a span), then call `getRequestLogger()` inside.
- **Structured errors**: Prefer `createStructuredError` over `new Error()` in API routes and services. On the client, use `parseError(caught)` to show message/why/fix in UI.
- **Span Event deprecation direction**: Existing span-event data remains supported, but new code should prefer log-based correlated events and keep span-timeline compatibility as an implementation detail.
- **Reaching the span**: Prefer the ambient `ctx` import (`import { trace, ctx } from 'autotel'`) over threading a context parameter. It resolves to the active span at any depth, so a helper several frames inside a traced body sees the same span without being handed anything. `trace.run`'s `ctx` parameter is there for when an explicit binding reads better.
- **`trace` wraps, `trace.run` runs**: Every `trace(...)` form returns a wrapper and executes nothing, so a `trace()` call can never run user code at module load. `trace.run(nameOrOptions, operation)` is the only immediate form. Because the two are separate names, no call shape is ambiguous and nothing needs to inspect a callback's parameter name, so #166 cannot recur. Never reintroduce an overload where the same call shape can either wrap or run. `instrument({ key, fn })` is the options form of the wrapper and `withTracing({ name })((ctx) => fn)` the reusable context factory. Keep edge behavior identical.
- **Stable names in examples**: Runnable examples must not emit `unknown` span names. Use `trace('operation.name', fn)` for a reusable function, or `trace.run('operation.name', ctx => result)` for immediate work, when inference is not guaranteed.
- **Ambient span identity**: Inside a traced body, `getActiveTraceContext()`, `getActiveSpan()`, and anything else reading `context.active()` must resolve to **that function's own span**, including after baggage mutations and when the function is nested inside another traced function. Stored context owns retained baggage only; `getActiveContextWithBaggage()` overlays that baggage onto the current OTel context so a stored ancestor or ended child span can never replace the active span. `wrapWithTracingSync` also explicitly attaches its new span before invoking the body. Covered by `packages/autotel/src/ambient-span-identity.test.ts`.
- **Testing context binding**: `createTraceCollector()` substitutes mock spans backed by its own AsyncLocalStorage, so it records what the mock saw and cannot prove which span the OTel context was bound to. To test context propagation, use `init({ spanProcessor: new SimpleSpanProcessor(new InMemorySpanExporter()) })` and assert on exported spans. `configure({ tracer })` on its own is not enough: without `init()` nothing registers a context manager and `context.active()` never leaves ROOT. `init()` wires its pipeline once per process, so create the exporter once and `reset()` it between tests rather than re-initialising.

---

## Framework Quick Reference (for suggesting setup)

| Framework              | Where to look / what to suggest                                                                                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Hono**               | `autotel-hono` + `autotel-adapters/hono` (`autotelMiddleware`, `useLogger`).                                                                                                                                                                                                                                 |
| **Fastify**            | `autotel-adapters/fastify` (`withAutotel`, `useLogger`).                                                                                                                                                                                                                                                     |
| **Express**            | `autotel-adapters/express` (`withAutotel`, `useLogger`).                                                                                                                                                                                                                                                     |
| **NestJS**             | `autotel-adapters/nestjs` (`AutotelInterceptor`, `useLogger`).                                                                                                                                                                                                                                               |
| **SvelteKit**          | `autotel-adapters/sveltekit` (`autotelHandle`, `useLogger`).                                                                                                                                                                                                                                                 |
| **Elysia**             | `autotel-adapters/elysia` (`withAutotelHandler`, `useLogger`).                                                                                                                                                                                                                                               |
| **Nuxt**               | `autotel-nuxt` module + `autotel-adapters/nitro`.                                                                                                                                                                                                                                                            |
| **TanStack Start**     | `autotel-tanstack`: middleware, env; see package CLAUDE and `apps/example-tanstack-start`.                                                                                                                                                                                                                   |
| **Cloudflare Workers** | `autotel-cloudflare` + `autotel-adapters/cloudflare` (`withAutotelFetch`, `waitUntil`).                                                                                                                                                                                                                      |
| **Next.js**            | `autotel-adapters/next` (`withAutotel`, streaming-aware emit).                                                                                                                                                                                                                                               |
| **Custom HTTP**        | `autotel-adapters/toolkit` (`defineFrameworkIntegration`); see `examples/community-framework-skeleton/`.                                                                                                                                                                                                     |
| **Browser / SPA**      | `autotel-web`: `init()` auto-injects `traceparent`. For per-tenant tracing, call `setBaggage({ 'tenant.id': id })` after login: it propagates as a W3C `baggage` header (same-origin/fail-closed) and the backend's `BaggageSpanProcessor` tags server spans. Do **not** hand-roll a fetch wrapper for this. |

Always suggest `init()` (or instrumentation) once at app entry; then spans + request logger or `trace()` in handlers.

---

## Invariants (do not break)

- **Synchronous init**: `init()` must stay synchronous. Use `node-require` helpers for optional/dynamic imports, never `await import()` for init-time loading.
- **Process lifecycle**: Importing `autotel` must not register process listeners. Opt in during `init()` with `processHandlers`; keep signal and fatal-error handling independently configurable and bounded. Applications with broader resource cleanup should own their process handlers and call `shutdown()` explicitly.
- **Tree-shaking**: Packages use explicit `exports` in `package.json`. Do not add barrel re-exports that pull in unused modules.
- **Functional API seam**: Keep `packages/autotel/src/functional.ts` as the public façade. Functional wrapper lifecycle logic and the shared option types belong in `functional-wrapper.ts`, behind `wrapPlainWithTracing()` and `wrapFactoryWithTracing()`. `functional.ts` imports from `functional-wrapper.ts` and never the reverse; re-export public types from the façade rather than importing back. Any new file on the path between a user's `trace()` call and `inferVariableNameFromCallStack()` must be added to `INTERNAL_FRAME_MODULES` in `variable-name-inference.ts`.
- **Test split**: Unit tests `*.test.ts`; integration tests `*.integration.test.ts` (separate config in core package).
- **Executable examples**: Changes to public APIs must keep `apps/book-chapters` type-checking and all chapter scripts runnable via its `run-all` command.
- **No secrets**: Never commit API keys, tokens, or secrets. Do not log sensitive data in examples or docs.
- **Vendor read APIs**: Implement read backends against the vendor's current documented endpoint and response envelope, and make fixtures mirror that contract. When a search API returns matching spans rather than complete traces, use it to discover trace IDs and hydrate each full trace before running trace-level analysis.
- **Devtools transports and embedding**: `autotel-devtools` accepts OTLP/gRPC on `:4317` and OTLP/HTTP on `:4318`; both must feed the same ingestion method. `createDevtools()` stays embeddable without claiming the gRPC port; start the exported gRPC receiver when an embedder wants it.

---

## Start With the Map (before suggesting instrumentation)

Do not guess which handlers are dark. `autotel map` reads the source, finds every
entry point for the detected framework, and reports per-check verdicts with
evidence and a fix:

```bash
npx autotel map --json --no-write            # whole project
npx autotel map --json --no-write <route|file>  # one entry point
npx autotel map --min-score 70               # CI gate (exit 1 below threshold)
npx autotel map --baseline git:origin/main   # CI gate (exit 1 on regression)
```

Each entry in `map.routes[].checks` carries `status`, `message`, `evidence`
(`file`, `line`, `snippet`) and `fix`. Work from those. The checks map directly
onto the checklist below: `trace` → span exists, `context` → request logger with
attributes, `structured-errors` → `createStructuredError`, `error-handling` →
catch blocks that record, `audit` → a security event on money and auth paths,
and `page-error-handling` → data-loading pages have an error path.

`autotel.map.json` is committed, so the score is trackable over time. Waive a check that should not apply with an
`// autotel-map-disable <check> -- reason` comment in code rather than lowering
the threshold.

---

## Instrumentation Review Checklist (when reviewing or writing code)

Use this when adding or reviewing instrumentation in a codebase that uses Autotel.

### Traces and spans

- [ ] Handlers / entry points wrapped with `trace()` or equivalent span creation (e.g. framework middleware).
- [ ] Nested operations use `trace()` or `span()` where they represent a meaningful unit of work.
- [ ] Span names are meaningful (inferred from function/variable name, or explicit via `trace(name, fn)` / `instrument({ key })`).
- [ ] Important context is set via `ctx.setAttribute()` or request logger `.set()`.

### Request-scoped context

- [ ] When “one snapshot per request” is needed, use `getRequestLogger(ctx?)` and call `.set()`, `.info()`/`.warn()`/`.error()` as the request runs; call `.emitNow()` (or rely on middleware) at the end.
- [ ] Request logger is only used inside an active span (or with explicit `TraceContext`).

### Errors

- [ ] API and service errors use `createStructuredError({ message, why?, fix?, link?, status?, cause? })` instead of `new Error()` where useful for debugging and UX.
- [ ] Client-side: API errors are parsed with `parseError(err)` and message/why/fix/link shown in UI (toast, banner, etc.).
- [ ] When recording errors on a span, use `recordStructuredError()` or the request logger’s `.error()`.

### Events (product/analytics)

- [ ] User/business events use `track(name, attributes)` or the Event API, not raw console or ad-hoc HTTP.

### Anti-patterns

- [ ] No raw `console.log` for request/response or business context when request logger or span attributes are available.
- [ ] No `throw new Error('...')` when structured context (why, fix, link) would help.
- [ ] No `await import()` for init-time optional dependencies; use `node-require` helpers.
- [ ] No logging of secrets, tokens, or full PII; use redaction or omit.

---

## Suggested Review Comments (for PRs or suggestions)

Use these when suggesting changes to user code:

**Missing instrumentation**

> Add a span for this handler with `trace()` (or the framework’s Autotel middleware), then use `getRequestLogger()` to attach request-scoped context and call `.emitNow()` at the end.

**Generic error**

> Use `createStructuredError({ message, status, why, fix, link, cause })` from `autotel` so the error is machine-parseable and the client can show message/why/fix via `parseError()`.

**Client not using structured error**

> On the client, use `parseError(err)` from `autotel` and show `error.message`, `error.why`, and `error.fix` in your toast/error UI.

**Scattered logging**

> Replace multiple logs with a single request-scoped snapshot: use `getRequestLogger()` and `.set()` throughout the request, then `.emitNow()` (or rely on middleware) so one coherent snapshot is emitted per request.

**Security-relevant path without telemetry**

> This is a security decision point (auth, access control, key/secret handling, payment, tenant boundary). Emit `securityEvent({ name, category, outcome, severity })` from `autotel-audit` so the signal survives tail sampling and feeds the `autotel.security.events` counter. Autotel records the event; this handler still enforces the decision. Use `hashIdentifier()` for emails/IPs. Never raw PII or secrets (the credential-key guard drops them, but don't rely on it).

**Wrong import or init**

> Use `init()` from `autotel` (or `autotel/instrumentation`) once at startup. Use `trace` / `span` / `instrument` and `getRequestLogger` from `autotel`. See `packages/autotel/package.json` exports for the exact subpaths.

---

## Where to Go Deeper

- **Before/after examples, when to use what, framework snippets**: `docs/AGENT-GUIDE.md`
- **Cloudflare package direction and DX target**: `docs/CLOUDFLARE-DX.md`
- **Code patterns and architecture**: `docs/ARCHITECTURE.md`
- **Config and env**: `docs/CONFIGURATION.md`
- **Development and testing**: `docs/DEVELOPMENT.md`
- **Per-package entry points and patterns**: `packages/<name>/CLAUDE.md`

---

## Summary: Making Autotel the Right Fit for AI Coding Agents

1. **Single source of truth**: This file (AGENTS.md): keep it updated when patterns or rules change.
2. **Clear API surface**: Suggest `trace` / `span` / `instrument`, `getRequestLogger`, `createStructuredError` / `parseError`, `track` / Event API, and `init()`; point to package exports for subpaths.
3. **Structured errors**: Always prefer structured errors and `parseError()` on the client so agents and users get explainable, actionable errors.
4. **Review checklist**: Use the instrumentation checklist and anti-patterns above when reviewing or generating code.
5. **Consistent suggestions**: Use the suggested review comments so recommendations are consistent and copy-paste friendly.
6. **Discoverability**: Point to AGENT-GUIDE.md and package CLAUDE.md files so the agent knows where to find examples and touchpoints for new integrations.
