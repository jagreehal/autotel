---
'autotel': patch
'autotel-cli': patch
'autotel-mcp': minor
'autotel-terminal': patch
'autotel-devtools': patch
---

`trace()`, `withTracing()` and `dbClient()` resolve the tracer per call, so a wrapper created at module load honours a `configure({ tracer })` made afterwards. `createTraceCollector()` records spans from modules imported before it was created, and registers the SDK's `AsyncLocalStorageContextManager` when none is active, so the ambient `ctx`, parent/child nesting and `context.bind()` work in a jest or vitest project that never called `init()`. `@opentelemetry/context-async-hooks` is now a dependency. The `require` condition of every export points at the `.d.cts` declarations, so CommonJS consumers under `module: Node16` type-check.

`autotel map` reads CommonJS bindings: `const { trace } = require('autotel')`, aliased destructuring and `const autotel = require('autotel')` count the same as `import` declarations, and a bare `require('passport')` marks the file as handling auth.

`autotel-mcp`: `find_anomalies`, `find_errors`, `check_slos` and `explain_slowdown` take `serviceName`, the argument name every other tool uses; `service` is removed. `score_span_instrumentation` accepts `{ traceId, spanId }` from any search or diagnosis result as well as a span object, and scores without asking for a `trace.id` tag. A single-span result keeps the span's own attributes on the span and hoists only resource-convention namespaces (`service.*`, `host.*`, `process.*`, ...).

Docs and skills: every command reads `npx autotel-cli <command>`, the package that has the `bin`. The `autotel-terminal` skill, README and `renderTerminal()` JSDoc show the `StreamingSpanProcessor` created before `init()` with its stream passed explicitly, plus the `import()` form a CommonJS app uses for the ESM-only package.
