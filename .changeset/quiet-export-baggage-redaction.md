---
'autotel': patch
---

- Exporters print one warning when a backend rejects an export (HTTP 401, 403 or 404; gRPC `UNAUTHENTICATED`, `PERMISSION_DENIED` or `UNIMPLEMENTED`), naming the signal, endpoint and response.
- `attributeRedactor` redacts span event and link attributes as well as span attributes.
- `traceConsumer({ extractBaggage: true })` runs the handler under the W3C baggage from the message's `baggage` header.
- `createTraceCollector()` spans record `recordException()` as an `exception` event.
