---
'autotel-devtools': minor
'autotel-web': minor
'autotel': minor
---

**autotel-devtools**: Timeline rows and trace-list rows show only the span name; the attributes moved into hover cards. Hover a trace-list row, or press Space on the cursor row, for a card with the operation name, the services it crossed, the span where the failure started, the spans with the most self time, and the root span's attributes.

**autotel-web**:

- `autotel-web/metrics`: `initMetrics()`, `createCounter`, `createUpDownCounter`, `createHistogram`, `flushMetrics`, `shutdownMetrics`. Takes the service, endpoint and release from `init()` / `initFull()`, exports delta temporality to `/v1/metrics` every 15s and when the page is hidden, and stays out of the lean and full bundles.
- `spanExporters` adds span destinations beside `endpoint`, each in its own batch. `propagator` sets the header format, e.g. B3.
- The `span()` handle gains `event()`, a log record carrying the span's trace and span id.
- Sessions take `maxDurationMs` and `onStart` / `onEnd` callbacks in both modes.

**autotel**: With `logs: true`, `debug: 'pretty'` prints one line per log record beside the span trees, and `debug: true` prints the raw records. No endpoint needed.
