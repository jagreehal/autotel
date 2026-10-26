---
'autotel': patch
'autotel-devtools': patch
'autotel-mcp': patch
'autotel-vitest': minor
---

**autotel**

- A second `init()` shuts the previous pipeline down, flushing what it holds, and starts the new config. Instrumentations from the earlier call follow the new pipeline, and a provider or propagator your application registered stays in place. If the new config throws, the running pipeline keeps going. The console warning names the usual cause: two setup files that each call `init()`.
- `shutdown()` releases the OpenTelemetry globals, so `init()` afterwards starts a fresh pipeline.
- `trace()`, `span()` and tracers from `getTracer()` resolve the current provider on each span, so they follow a re-init. A tracer passed to `configure({ tracer })` stays as given.
- `debug: 'pretty'` prints one tree per trace when the trace's root span ends, with `│` guides at every depth. A trace whose root never exports (a filtered parent) prints after two idle seconds, and `flush()` prints anything still waiting.

**autotel-devtools**

- Every route answers a malformed request: 400 with `{ "error": "Invalid JSON" }` for a body it cannot parse, 500 for any other error (also logged). The server keeps serving.

**autotel-mcp**

- Span filters accept the field names the tools use: `operation`, `operationName`, `operation_name` and `service` all resolve. camelCase spellings such as `serviceName` and `durationMs` work too, and `groupBy` shares the same vocabulary.
- When `search_spans`, `search_traces` or `aggregate_spans` return nothing and none of 100 unfiltered results from the window carries a filter's field, the response's `hint` names that field.

**autotel-vitest**

- `autotel-vitest/setup`: list it in `setupFiles` and every test gets its span through Vitest's `aroundEach`, with test files unchanged.
- A failed test marks its span `ERROR` and records the test's errors.
- When no collector acknowledges a flush, the test keeps its own result. The fixture warns once and stops flushing in that worker, so you wait out one timeout, and `task.meta.otelSpans` still fills.
- The `vitest` peer range is `>=5.0.0`.
- README: how to trace packages loaded with `import` under Vitest, through a `resolve.alias` shim.
