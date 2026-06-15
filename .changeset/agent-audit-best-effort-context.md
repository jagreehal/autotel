---
"autotel": minor
"autotel-agent": minor
"autotel-audit": minor
"autotel-edge": patch
---

Best-effort agent/audit instrumentation, OpenTelemetry-portable context, and LLM telemetry

- **Best-effort by default — observability never throws into business logic.**
  `withAudit`, `withAgentAction`, `withAgentToolCall`, `recordPolicyDecision`, and
  `securityEvent` / `withSecurity` no longer throw when there is no active trace
  context. A new `onMissingContext: 'throw' | 'warn' | 'skip'` option (default
  `'warn'`) controls the behaviour: run the handler un-audited and warn once, run
  silently, or opt back into fail-fast. This makes the 0.x agent layer safe to
  drop into a production hot path with no surrounding `trace()` and no `try`/`catch`.

- **OpenTelemetry-portable context.** `autotel-agent` / `autotel-audit` resolve
  trace context from any active OpenTelemetry span, not only inside autotel's own
  `trace()`. The wrappers now compose inside `@effect/opentelemetry`, a vanilla
  NodeSDK, and `autotel-cloudflare`-instrumented `fetch` handlers and Cloudflare
  **Workflows** (`instrumentWorkflow` `step.do` callbacks).

- **LLM cost & token telemetry (autotel-agent).** Agent actions / tool calls can
  carry `ai` metadata (`{ model, operation?, usage?, finishReasons?, pricing? }`);
  autotel-agent records OpenTelemetry GenAI attributes (`gen_ai.request.model`,
  `gen_ai.usage.{input,output,total}_tokens`, and the estimated
  `gen_ai.usage.cost.usd`) reusing `estimateLLMCost` / `MODEL_PRICING` from the
  main `autotel` package. `options.extractUsage(result)` pulls token counts from
  the handler result.

- **Cloudflare Workflow context propagation (autotel-edge).**
  `WorkerTracerProvider.register()` now registers its AsyncLocalStorage context
  manager with the global OpenTelemetry API (`setGlobalContextManager`). Without
  this the active span was lost after the first `await`, so `trace.getActiveSpan()`
  returned `undefined` inside handlers / Workflow steps — the root cause of
  agent/audit failing to compose there.

- **Workers-idiomatic `node:` imports.** `autotel-agent` and `autotel-audit` keep
  the `node:` prefix on built-in imports (e.g. `node:crypto`) in their published
  bundles, so they no longer silently rely on the Workers `nodejs_compat` alias.

- **New `autotel` helpers:** `getRequestLoggerSafe()` (returns the request logger
  or `null` instead of throwing), `createNoopRequestLogger()`, and
  `hasRequestContext()`.
