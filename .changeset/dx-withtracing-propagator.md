---
'autotel': patch
---

- `withTracing()` types the wrapper from the factory: an async handler gives `(...args) => Promise<T>`, a sync one `(...args) => T`, and one that returns either gives `(...args) => T | Promise<T>`.
- `createTraceCollector()` registers the W3C trace-context and baggage propagator, so `propagation.inject`/`extract` work in tests without `init()`. A propagator the test set stays in place.
