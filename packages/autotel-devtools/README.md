# autotel-devtools

Standalone OTLP receiver with web UI for local development. Think TanStack Devtools for OpenTelemetry.

## Overview

`autotel-devtools` provides two modes:

1. **Standalone OTLP Receiver** - Run as CLI to receive OpenTelemetry data
2. **Embeddable Widget** - Add a devtools panel to your web app

```
┌─────────────────────────────────────────────┐
│  Standalone Mode                            │
│                                             │
│  npx autotel-devtools                       │
│  ┌───────────────────────────────────────┐ │
│  │  HTTP Server (port 4318)               │ │
│  │  ├── POST /v1/traces  ← OTLP JSON/PB │ │
│  │  ├── POST /v1/logs     ← OTLP JSON/PB │ │
│  │  ├── POST /v1/metrics  ← OTLP JSON/PB │ │
│  │  ├── GET  /            → Full page UI  │ │
│  │  ├── GET  /widget.js   → Widget bundle │ │
│  │  ├── GET  /healthz     → Health check  │ │
│  │  └── WS   /ws          ←→ WebSocket    │ │
│  └───────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

## Quick Start

### Standalone Mode

```bash
# Run the OTLP receiver
npx autotel-devtools

# Configure your app to send to it
OTEL_EXPORTER_OTLP_PROTOCOL=http/json \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
node app.js
```

The endpoints accept **both OTLP/JSON and OTLP/protobuf** (`application/x-protobuf`),
selected automatically from the request `Content-Type`. That means SDKs that default
to protobuf over OTLP HTTP — including the Python, Java, and Go OpenTelemetry SDKs —
work without any extra configuration:

```bash
# Python / Java / Go SDKs default to http/protobuf — just point them at the receiver
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 python app.py
```

Open http://localhost:4318 to see traces, logs, and metrics.

### Embedded Widget

Add the widget to your web app:

```html
<script src="http://localhost:4318/widget.js"></script>
<autotel-devtools></autotel-devtools>
```

Or programmatically:

```html
<script>
  // Mount the widget manually
  const container = document.createElement('div');
  document.body.appendChild(container);

  // Auto-detect WebSocket URL
  const script = document.currentScript;
  const widgetUrl = new URL(script.src);
  const wsUrl = `ws://${widgetUrl.host}/ws`;

  // Widget opens as a floating panel
</script>
```

### Programmatic API

Use in Node.js with autotel:

```typescript
import { init, trace } from 'autotel';
import { createDevtools } from 'autotel-devtools';

const { server, httpServer, exporter, port, close } = createDevtools({
  port: 4318,
  verbose: true,
});

// Wire up to autotel
init({
  service: 'my-app',
  endpoint: 'http://localhost:4318',
  spanProcessors: [exporter], // Stream to devtools
});

// Your traced code
const myFunction = trace((ctx) => async () => {
  // ... this span appears in devtools
});
```

## Architecture

### Server (Node.js)

- **DevtoolsServer** - WebSocket server + in-memory data store
- **HTTP Routes** - OTLP receivers for traces/logs/metrics (JSON + protobuf)
- **Exporters** - OpenTelemetry span/log exporters

### Widget (Svelte 5)

- **Shadow DOM** - Isolated styles, no conflicts with app CSS
- **Svelte 5 runes** - Reactive state via a signal shim that preserves a `.value` API
- **Views** - Traces, Logs, Metrics, Errors, Resources, Service Map

## Features

### Implemented

- ✅ Real-time OTLP ingestion (traces, logs, metrics)
- ✅ WebSocket streaming with history replay
- ✅ Traces view with waterfall + flame graph
- ✅ Logs view with severity/resource filtering
- ✅ Error aggregation and grouping
- ✅ Service map visualization
- ✅ Resources view (derived from telemetry)
- ✅ Search with debounce (300ms)
- ✅ Configurable telemetry limits (env vars)
- ✅ Widget position persistence (localStorage)
- ✅ Export traces as JSON
- ✅ Custom element support (`<autotel-devtools>`)

## Configuration

### Environment Variables

```bash
AUTOTEL_MAX_TRACE_COUNT=10000    # Max traces to keep (default: 100)
AUTOTEL_MAX_LOG_COUNT=10000      # Max logs to keep (default: 100)
AUTOTEL_MAX_METRIC_COUNT=50000   # Max metrics to keep (default: 100)
AUTOTEL_DEVTOOLS_PORT=4318       # Server port (default: 4318)
AUTOTEL_DEVTOOLS_HOST=127.0.0.1  # Bind host (default: 127.0.0.1)
AUTOTEL_DEVTOOLS_TITLE="My App"  # Dashboard title (optional)
```

### CLI Options

```bash
npx autotel-devtools --port 4319 --host 0.0.0.0
```

Options:

- `--port, -p` - Port to listen on (default: 4318)
- `--host, -H` - Host to bind to (default: 127.0.0.1)
- `--title, -t` - Dashboard title

When bound to a loopback host, the receiver listens on **both** `127.0.0.1`
and `::1`, so a client connecting via `localhost` reaches it regardless of how
the OS resolves `localhost` (macOS prefers IPv6 `::1`). The startup banner
prints every address it bound; if a family can't be bound you get a warning,
not a silent black hole.

## Behind a dev-server proxy

If your app's dev server proxies `/v1/traces` to the receiver, two classic
bugs make spans vanish with **no error** — both worth knowing:

```ts
// Express / http-proxy-middleware
import { createProxyMiddleware } from 'http-proxy-middleware';

app.use(
  '/v1/traces',
  createProxyMiddleware({
    // (a) Express strips the mount prefix before calling middleware, so the
    //     proxy would otherwise forward "/" instead of "/v1/traces".
    pathRewrite: () => '/v1/traces',
    // (b) Use 127.0.0.1, NOT localhost. On macOS `localhost` resolves to ::1;
    //     pin the family so you reach the receiver deterministically.
    target: 'http://127.0.0.1:4318',
    changeOrigin: true,
  }),
);
```

> Symptom of either bug: the browser shows the request leaving (200/no error),
> but the receiver stays empty. Always verify on the **receiver** side (below),
> not just that the browser tried to send.

## Verifying ingestion in tests

The receiver exposes an HTTP read-back so a test can assert the collector
**actually received** spans — instead of asserting "the client tried to send",
which a browser-level route intercept can fake (it fulfils the request before
it reaches any server):

```bash
GET    /v1/traces   # → { traces: [...], count: N }  what the receiver has
DELETE /v1/traces   # clear captured telemetry (reset between tests)
```

```ts
// Playwright / integration test — bypass any page.route() intercept and ask
// the collector directly.
await fetch(`${RECEIVER}/v1/traces`, { method: 'DELETE' }); // reset
await runTheUserFlow();                                      // app emits spans
await expect
  .poll(async () => (await (await fetch(`${RECEIVER}/v1/traces`)).json()).count)
  .toBeGreaterThan(0);
```

## License

MIT
