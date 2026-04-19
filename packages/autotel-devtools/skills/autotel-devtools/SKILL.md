---
name: autotel-devtools
description: >
  Standalone OTLP receiver with a Preact web UI for local-dev observability. Use when a developer wants to see OpenTelemetry traces, logs, metrics, and service maps streaming from a running app without setting up Jaeger/Tempo/Prometheus — either as a CLI dashboard or an embedded `<autotel-devtools>` widget.
type: integration
library: autotel-devtools
library_version: '1.0.1'
sources:
  - jagreehal/autotel:packages/autotel-devtools/CLAUDE.md
  - jagreehal/autotel:packages/autotel-devtools/README.md
---

# autotel-devtools

Local-dev OTLP receiver with a browser UI. Think TanStack Devtools for OpenTelemetry — runs as CLI or embeds as a Shadow-DOM-isolated widget in any web app.

## Quick Start — pick an approach

### Standalone dashboard

```bash
npx autotel-devtools
# → OTLP receiver on :4318, UI at http://localhost:4318
```

Point any OTel-instrumented app at it:

```bash
OTEL_EXPORTER_OTLP_PROTOCOL=http/json \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
node app.js
```

### Embedded widget

```html
<script src="http://localhost:4318/widget.js"></script>
<autotel-devtools></autotel-devtools>
```

Shadow-DOM-isolated — never leaks styles into the host page.

### Programmatic (Node + autotel)

```typescript
import { init, trace } from 'autotel';
import { createDevtools } from 'autotel-devtools';

const { exporter, close } = createDevtools({ port: 4318, verbose: true });

init({
  service: 'my-app',
  endpoint: 'http://localhost:4318',
  spanProcessors: [exporter], // stream spans to the devtools UI
});

export const loadUser = trace(ctx => async (id: string) => {
  // ... span shows up live in devtools
});
```

## Package Entry Points

| Import | What |
| --- | --- |
| `autotel-devtools` | `createDevtools()`, `DevtoolsServer`, exporters, types |
| `autotel-devtools/server` | `DevtoolsServer`, OTLP parsing (`parseOtlpTraces`, `parseOtlpLogs`), HTTP routes (`attachDevtoolsRoutes`, `createDevtoolsHttpServer`), telemetry-limit helpers |
| `autotel-devtools/exporter` | `DevtoolsSpanExporter` (standalone) |

## Server Endpoints

| Route | What |
| --- | --- |
| `POST /v1/traces` · `/v1/logs` · `/v1/metrics` | OTLP JSON receivers |
| `GET /` | Dashboard UI (traces, logs, metrics, errors, resources, service map) |
| `GET /widget.js` | Embeddable widget bundle (IIFE) |
| `GET /healthz` | Health check |
| `WS /ws` | WebSocket stream (history replay on connect) |

## Views in the UI

- **Traces** — waterfall + flame graph, search with 300 ms debounce
- **Logs** — severity/resource filtering
- **Metrics** — per-metric time series
- **Errors** — aggregated and grouped by fingerprint
- **Resources** — derived from ingested telemetry
- **Service map** — visualises call graph

## Environment Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `AUTOTEL_DEVTOOLS_PORT` | `4318` | Server port |
| `AUTOTEL_DEVTOOLS_HOST` | `127.0.0.1` | Bind host |
| `AUTOTEL_DEVTOOLS_TITLE` | — | Dashboard title |
| `AUTOTEL_MAX_TRACE_COUNT` | `100` | Max traces retained in memory |
| `AUTOTEL_MAX_LOG_COUNT` | `100` | Max logs retained |
| `AUTOTEL_MAX_METRIC_COUNT` | `100` | Max metric points retained |

## CLI

```bash
npx autotel-devtools --port 4319 --host 0.0.0.0 --title "My App"
```

| Flag | Short | Purpose |
| --- | --- | --- |
| `--port` | `-p` | Listen port (default 4318) |
| `--host` | `-H` | Bind host (default 127.0.0.1) |
| `--title` | `-t` | Dashboard title |

## Works With

- **autotel** — pass `exporter` into `spanProcessors` for live streaming
- **Standard OpenTelemetry SDK** — any OTLP exporter targeting `http://localhost:4318` works; autotel is not required
- **Browser apps** — the widget is a custom element with Shadow DOM, so drop it in without CSS conflicts

## Common Mistakes

- Do NOT use the widget in Node — it's a browser-only IIFE bundle. Use `createDevtools()` server-side instead.
- Do NOT set a production OTLP endpoint at `localhost:4318` — devtools is in-memory only (no persistence, caps at 100 items per signal by default). Bump `AUTOTEL_MAX_*_COUNT` for longer local sessions.
- Do NOT embed the widget into pages served via strict CSP without allowing `http://localhost:4318` — the WebSocket connection and script load both need the devtools origin allowed.
- Do NOT confuse the two builds — the **server** uses tsup (Node ESM + CJS), the **widget** uses Vite's IIFE build. Don't import `autotel-devtools/server` into widget code; it pulls in Node APIs.
