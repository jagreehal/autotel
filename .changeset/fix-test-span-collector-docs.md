---
"autotel": patch
---

docs(test-span-collector): fix stale `@example` for OpenTelemetry SDK v2

The `TestSpanCollector` JSDoc example used `getAutotelTracerProvider().addSpanProcessor(...)`, which no longer exists on SDK v2 providers, so following it produced a collector that never received spans. The example now shows the working wiring — construct a `NodeTracerProvider` with the processors and register it via `setAutotelTracerProvider()`, then create spans through `getAutotelTracer()` — and points to `createTraceCollector()` (`autotel/testing`) and `InMemorySpanExporter` (`autotel/exporters`) for high- and low-level testing.
