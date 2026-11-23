---
'autotel': minor
'autotel-mcp': minor
'autotel-mcp-instrumentation': minor
'autotel-devtools': minor
---

Follow a feature flag across services, receive telemetry as MCP Events, and rely on every baggage write.

**autotel**

- `autotel/feature-flags` adds `featureFlagBaggage()` and `featureFlagBaggageProvider()`. Evaluate flags once at the edge, carry the answers in W3C baggage, and read them downstream through OpenFeature, so every service in a request sees the same variant during a rollout. Downstream evaluations record `reason: cached` with the edge's `feature_flag.version`. The edge replaces inbound flag baggage, so a client cannot choose its own variant.
- `ctx.setBaggage()` keeps a child operation's write for the rest of the request and honours a `context.with()` override inside its callback. Inside an autotel trace a write lasts for the request; inside another OpenTelemetry scope, such as an auto-instrumented request, it lasts for that scope; at the root autotel writes nothing. `@Trace()` methods open their own scope. Lone surrogates become U+FFFD, so the propagator encodes every entry.
- `createSafeBaggageSchema()` and `BusinessBaggage` write through the same path, so `set()`, `setValue()`, `fromHeaders()` and `clear()` change what the request reads and sends. `fromHeaders()` imports only the header's values and keeps a hash the sender made, so a hashed ID stays the same at every hop. `maxTotalSize` (default and maximum 8192) counts the outgoing `baggage` header in bytes, the way OpenTelemetry sends it. The schema keeps the most writes of a batch that the propagator will send and reports the rest to `onError` as `size`; a write outside any scope reports `no_trace`. Reads fall back to a field's `defaultValue`, and a write never throws.

**autotel-mcp**

- Telemetry as MCP Events (SEP-3415) through `events/list` and `events/poll`: `autotel.issue.opened` for an error seen for the first time, and `autotel.deploy.detected` for a new `service.version` or a rollback, with error rate and p95 before and after. Cursors replay up to 24 hours and trail now by two minutes, so late-indexed records arrive. `maxAgeMs` bounds replay, and a skipped range or capped sample sets `truncated: true`. Event ids stay stable, so you can drop duplicates. Poll every 60 seconds, or every 5 minutes on Datadog. Payloads carry no error text; fetch it with `get_issue`.
- `what_changed` reports `flagChanges`: each `feature_flag.version` change per service, with error rate and p95 before and after. It confirms a rollback after three spans in a row of the earlier version, and each change carries `confirmedAtUnixMs`. It splits a full quarter of its sample once more so a burst keeps both sides of a change (except on Datadog, to stay within its spans budget), and it says when its sample was capped.

**autotel-mcp-instrumentation**

- Traces MCP Events on both ends with no Events API in the SDK. Server handlers for `events/list`, `events/poll`, `events/subscribe` and `events/unsubscribe` get `{method} {event name}` spans; a poll records `mcp.event.count`, `mcp.event.truncated` and `mcp.event.has_more`. Each pushed occurrence gets a `send {event name}` producer span that writes its trace context into the occurrence's `_meta`.
- On the client, `request()` traces the same methods, a `notifications/events/event` handler runs in a `process {event name}` consumer span, and `processEvent(event, react, { delivery })` does the same for polled and webhook occurrences.
- Metrics `mcp.server.event.delivered`, `mcp.client.event.received`, `mcp.client.event.lag`, `mcp.client.event.gaps` and `mcp.client.event.subscription.terminated`, and attributes `mcp.event.name`, `mcp.event.id` and `mcp.event.delivery`. Spans and metrics record no payloads, and no metric carries an event id.

**autotel-devtools**

- Compare leaves out the fields its queries filter on, with the whole failure family when one of them is, and lists them as `ignoredFields`. Its picker offers feature flags beside experiments: pick a flag and a variant to compare against the others.
