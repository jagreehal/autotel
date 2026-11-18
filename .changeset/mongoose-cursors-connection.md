---
'autotel': minor
'autotel-mongoose': minor
'autotel-devtools': patch
---

**autotel**

- `ctx.event(name, attributes)` records an OpenTelemetry event correlated to the span, the same call as autotel-web's `s.event`. `ctx.track` stays product analytics for subscribers.
- Events export by default once there is an endpoint. With `logs` unset, autotel's log exporter sends records with an `eventName`; `logs: true` adds every log record. `logs: false` turns it off and warns once when an event reaches no destination.
- `ctx.event`, `transition()` history and feature-flag evaluations share one record shape: the name as `eventName`, body and `event.name`, at INFO.

**autotel-mongoose**

- A query or aggregate read through `.cursor()`, `for await`, `eachAsync()` or a stream gets one span that ends with the cursor.
- `replaceOne()`, `distinct()` and `connection.aggregate()` are traced.
- `server.address`, `server.port` and `db.namespace` come from each model's connection. `dbName`, `peerName` and `peerPort` override them.

**autotel-devtools**

- The trace hover card lists "Where the time went" in start order and skips spans under 1% of the trace. A trace with nothing beyond its name opens no card.
- The span panel opens "Resource & auto" when the app set no attributes.
