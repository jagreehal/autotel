---
'autotel-aws': minor
'autotel': minor
---

`autotel-aws/durable` adds Lambda durable functions support on top of AWS's OpenTelemetry plugin (`@aws/durable-execution-sdk-js-otel`):

- `durableFlush()` flushes autotel at the end of each invocation.
- `autotelContextExtractor` keeps the trace from Lambda's X-Ray header, lets autotel's sampler decide, and puts an execution started by `ctx.invoke()` with `withInvokeTraceContext()` in the caller's trace.
- `durableExecutionContext(event)` gives a consumer of `Durable Execution Status Change` events the execution's trace.

In `autotel`, a span under a parent in the same process keeps the parent's sampling decision, so a trace stays whole. A root span, or a span under a remote parent, asks the configured sampler as before.
