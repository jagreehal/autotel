---
'autotel-tanstack': patch
---

Improve type safety for TanStack-native middleware API. `createTracingServerHandler()` now returns a handler with the exact signature expected by `createMiddleware().server()`, eliminating the need for type assertions when using TanStack's native middleware builder pattern.
