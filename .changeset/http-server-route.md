---
'autotel': minor
'autotel-adapters': patch
---

`setHttpServerRoute(route)` hands a matched route to the HTTP server span `@opentelemetry/instrumentation-http` opened, which then records `http.route` and is named `METHOD route`. The framework adapters call it, so their requests can be grouped and joined by route.
