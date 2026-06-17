---
'autotel-edge': minor
'autotel-cloudflare': minor
---

feat(cloudflare): seamless integration with Cloudflare native tracing

`trace()` / `span()` / `enterSpan()` now automatically nest inside Cloudflare's
native trace waterfall when a Worker has native tracing enabled
(`observability.traces.enabled`), and Cloudflare exports them to your configured
destination — no exporter code, no duplicate binding spans. autotel falls back
to its own OTLP pipeline on other runtimes, when native tracing is off, or
locally (e.g. streaming to autotel-devtools).

- **autotel-edge**: new runtime-agnostic native-tracing seam
  (`withNativeTracer` / `getActiveNativeTracer`, `NativeTracer` /
  `NativeSpanHandle`), a new `enterSpan(name, cb)` convenience, and a
  `nativeTracing: 'auto' | 'on' | 'off'` config option (default `'auto'`).
- **autotel-cloudflare**: auto-detects `ctx.tracing`, wires it into the handler
  wrappers (`instrument` / `wrapModule` / `defineWorkerFetch` /
  `wrapDurableObject`), and defers binding instrumentation + export to the
  platform when native tracing is active. New `autotel-cloudflare/native` entry
  exporting `isNativeTracingAvailable` / `getNativeTracerFromCtx`.

See `docs/CLOUDFLARE-NATIVE-TRACING.md`.
