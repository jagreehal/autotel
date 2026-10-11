---
'autotel-cloudflare': patch
'autotel-edge': patch
'autotel': patch
---

- `autotel-cloudflare`: `instrumentWorkflow` with `nativeTracing: 'off'` registers the OTLP provider itself and exports the run and step spans before `run()` resolves. Step calls and RPC methods on an instrumented service binding go through `Reflect.apply`, which RPC stubs support.
- `autotel-edge`: `startSpan` and `startActiveSpan` read the native-tracer opt-out from the context you pass, so `withoutNativeTracer()` keeps a span on OTLP. Overlapping flushes of one trace export it once.
- `autotel`: `flush()` also flushes batched log records, including from a logger provider registered by a custom `sdkFactory`. Spans and logs flush independently under the same timeout.
