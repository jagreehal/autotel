---
'autotel': patch
---

Fix `flush()` silently exporting nothing on `@opentelemetry/sdk-node` 0.220+.

`flush()` and flush-on-shutdown force-flushed spans via `sdk.getTracerProvider()`, which returns `undefined` on sdk-node 0.220+ (OpenTelemetry 2.x). The guard treated `undefined` as "nothing to flush", so pending spans were never exported — breaking flush-before-return in serverless and any synchronous read of a span collector right after a traced call. A new `getForceFlushableProvider()` helper falls back to the globally registered provider and unwraps the API's `ProxyTracerProvider` to reach the delegate that actually implements `forceFlush`. Applied to `flush()` and all three auto-flush sites in the functional API.
