# Autotel — Guide for AI Coding Agents

This file is the **single source of truth** for AI coding assistants (Cursor, Claude Code, etc.) working in the Autotel repo or in codebases that use Autotel. Use it to suggest correct instrumentation, avoid anti-patterns, and keep changes consistent with project rules.

## Keeping This File Updated

Update this file proactively when:

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
- Keep `trace(..., (ctx) => ...)` as the main user-facing instrumentation pattern for Cloudflare business logic.
- Prefer span attributes plus one execution-scoped snapshot over scattered `logger.info(...)` calls in Cloudflare examples.
- If Cloudflare needs request-logger-style DX, implement it in `autotel-edge` first using edge-safe context primitives. Do not copy the Node `AsyncLocalStorage` implementation from core `autotel`.
- **Native tracing**: `trace()`/`span()`/`enterSpan()` auto-nest in Cloudflare's native trace waterfall when `observability.traces` is enabled (autotel detects `ctx.tracing`); it defers binding instrumentation + export to the platform and falls back to autotel's OTLP pipeline otherwise. The runtime-agnostic seam is in `autotel-edge` (`src/core/native-bridge.ts`); the CF adapter is in `autotel-cloudflare` (`src/native/native-tracing.ts`). Config: `nativeTracing: 'auto'|'on'|'off'`. Don't add CF imports to autotel-edge. See `docs/CLOUDFLARE-NATIVE-TRACING.md`.

---

## Quick Reference

| Command                | Description                              |
| ---------------------- | ---------------------------------------- |
| `pnpm build`           | Build all packages                       |
| `pnpm test`            | Run all tests                            |
| `pnpm lint`            | Lint all packages                        |
| `pnpm format`          | Format with Prettier                     |
| `pnpm quality`         | Build + lint + format + typecheck + test |

**Agent Skills:** Skills ship inside each package under `skills/` (e.g. `packages/autotel/skills/`, `packages/autotel-cloudflare/skills/`). They follow the open [Agent Skills specification](https://agentskills.io/specification) — skill-aware agents discover them by scanning the filesystem for `SKILL.md` files, no consumer-side CLI required.

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
│   ├── autotel-genai/         # GenAI/LLM: traceGenAI, cost, metrics, events, ai-sdk, agent governance (autotel-genai/agent)
│   ├── autotel-subscribers/   # Event subscribers (PostHog, etc.)
│   ├── autotel-web/           # Browser SDK: traceparent + W3C baggage propagation (setBaggage)
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

| Need                        | API / entry point                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| Wrap a function with a span | `trace(fn)`, `span(name, fn)`, `instrument({ key, fn })`                                         |
| Request-scoped attributes   | `getRequestLogger(ctx?)` → `.set()`, `.info()` / `.warn()` / `.error()`, `.emitNow()`, `.fork()` |
| Structured throw            | `createStructuredError({ message, why?, fix?, link?, status?, code?, cause? })`                  |
| Parse API errors (client)   | `parseError(err)` → `{ message, status, why?, fix?, link?, raw }`                                |
| Lock init (framework)       | `lockLogger()`, `isLoggerLocked()`                                                               |
| Product/analytics events    | `track(name, attributes)` or `Event` from `autotel/event`                                        |
| Observable input validation | `defineValidator(name, schema, { boundary, onMismatch })` from `autotel/validate` — records Zod/`safeParse` mismatches as `validation.*` spans + `autotel.validation.mismatches` counter. `reject` (default) records then throws a 400; `observe` records then returns raw input. PII-safe (paths/codes only). Security escalation is explicit opt-in via `onValidationMismatch()`. Not the same as `autotel-schema` (telemetry-surface contract) |
| Init (once at startup)      | `init({ service, ... })` from `autotel` or `autotel/instrumentation`                             |
| PII redaction               | `init({ attributeRedactor: 'default' | 'strict' | 'pci-dss' | { keyPatterns, valuePatterns } })`       |
| Testing                     | `createTraceCollector()` from `autotel/testing`; `InMemorySpanExporter` from `autotel/exporters` |
| Security observability hooks (OWASP A09) | Observability at security decision points: `securityEvent()` / `withSecurity()` / `hashIdentifier()` from `autotel-audit`; zero-code signals via `createSecuritySignalProcessor()` in `init({ spanProcessors })`. See `docs/SECURITY-OBSERVABILITY.md` and `integrations/security` in apps/docs. |
| GenAI/LLM calls | `traceGenAI()` (alias `traceLLM`) from `autotel-genai/trace`; pair with `recordGenAiResponse()`, `recordGenAiUsage()`, `setGenAiContent()`. Cost via `recordLLMCost`/`estimateLLMCost`/`MODEL_PRICING` from `autotel-genai/cost`; events via `recordInferenceDetails()`/`recordEvaluationResult()` from `autotel-genai/events`; metrics via `genAiMetricViews` from `autotel-genai/metrics`. Canonical `gen_ai.*` attributes only |
| Agent identity + auditability | `withAgentAction()`, `withAgentSession()`, `withScopedTool()`, `recordPolicyDecision()`, `recordDecisionBasis()`, `createAgentIdentityRegistry()`, `createSignedEventEnvelope()` from `autotel-genai/agent` |
| Agent security observability (Google SAIF) | `recordControllerId()`, `recordHumanApproval()`, `recordInputProvenance()`, `recordPlanStep()`, `recordPlanRiskAssessment()`, `runAgentPlanClassifier()`, `heuristicPlanRiskClassifier()` from `autotel-genai/agent`; MCP bridge via `createMcpSecurityEventBridge()` from `autotel-audit`; passive chain detection via `createSecuritySignalProcessor()`. See [`docs/AGENT-SECURITY-OBSERVABILITY.md`](docs/AGENT-SECURITY-OBSERVABILITY.md). |

- **Request logger** requires an active span (or explicit `TraceContext`). So wrap HTTP handlers with `trace()` (or framework middleware that creates a span), then call `getRequestLogger()` inside.
- **Structured errors**: Prefer `createStructuredError` over `new Error()` in API routes and services. On the client, use `parseError(caught)` to show message/why/fix in UI.
- **Span Event deprecation direction**: Existing span-event data remains supported, but new code should prefer log-based correlated events and keep span-timeline compatibility as an implementation detail.

---

## Framework Quick Reference (for suggesting setup)

| Framework              | Where to look / what to suggest                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Hono**               | `autotel-hono` + `autotel-adapters/hono` (`autotelMiddleware`, `useLogger`).                                |
| **Fastify**            | `autotel-adapters/fastify` (`withAutotel`, `useLogger`).                                                  |
| **Express**            | `autotel-adapters/express` (`withAutotel`, `useLogger`).                                                    |
| **NestJS**             | `autotel-adapters/nestjs` (`AutotelInterceptor`, `useLogger`).                                              |
| **SvelteKit**          | `autotel-adapters/sveltekit` (`autotelHandle`, `useLogger`).                                                |
| **Elysia**             | `autotel-adapters/elysia` (`withAutotelHandler`, `useLogger`).                                              |
| **Nuxt**               | `autotel-nuxt` module + `autotel-adapters/nitro`.                                                           |
| **TanStack Start**     | `autotel-tanstack`: middleware, env; see package CLAUDE and `apps/example-tanstack-start`.                  |
| **Cloudflare Workers** | `autotel-cloudflare` + `autotel-adapters/cloudflare` (`withAutotelFetch`, `waitUntil`).                      |
| **Next.js**            | `autotel-adapters/next` (`withAutotel`, streaming-aware emit).                                              |
| **Custom HTTP**        | `autotel-adapters/toolkit` (`defineFrameworkIntegration`); see `examples/community-framework-skeleton/`.    |
| **Browser / SPA**      | `autotel-web`: `init()` auto-injects `traceparent`. For per-tenant tracing, call `setBaggage({ 'tenant.id': id })` after login — it propagates as a W3C `baggage` header (same-origin/fail-closed) and the backend's `BaggageSpanProcessor` tags server spans. Do **not** hand-roll a fetch wrapper for this. |

Always suggest `init()` (or instrumentation) once at app entry; then spans + request logger or `trace()` in handlers.

---

## Invariants (do not break)

- **Synchronous init**: `init()` must stay synchronous. Use `node-require` helpers for optional/dynamic imports, never `await import()` for init-time loading.
- **Tree-shaking**: Packages use explicit `exports` in `package.json`. Do not add barrel re-exports that pull in unused modules.
- **Test split**: Unit tests `*.test.ts`; integration tests `*.integration.test.ts` (separate config in core package).
- **No secrets**: Never commit API keys, tokens, or secrets. Do not log sensitive data in examples or docs.

---

## Instrumentation Review Checklist (when reviewing or writing code)

Use this when adding or reviewing instrumentation in a codebase that uses Autotel.

### Traces and spans

- [ ] Handlers / entry points wrapped with `trace()` or equivalent span creation (e.g. framework middleware).
- [ ] Nested operations use `trace()` or `span()` where they represent a meaningful unit of work.
- [ ] Span names are meaningful (inferred from function/variable name or explicit `instrument({ key })`).
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

1. **Single source of truth**: This file (AGENTS.md) — keep it updated when patterns or rules change.
2. **Clear API surface**: Suggest `trace` / `span` / `instrument`, `getRequestLogger`, `createStructuredError` / `parseError`, `track` / Event API, and `init()`; point to package exports for subpaths.
3. **Structured errors**: Always prefer structured errors and `parseError()` on the client so agents and users get explainable, actionable errors.
4. **Review checklist**: Use the instrumentation checklist and anti-patterns above when reviewing or generating code.
5. **Consistent suggestions**: Use the suggested review comments so recommendations are consistent and copy-paste friendly.
6. **Discoverability**: Point to AGENT-GUIDE.md and package CLAUDE.md files so the agent knows where to find examples and touchpoints for new integrations.
