---
name: autotel-terminal
description: >
  Use this skill when integrating the autotel-terminal dashboard into a Node.js app or running it as a standalone OTLP receiver — covers renderTerminal(), StreamingSpanProcessor, the CLI, and the AI assistant configuration.
type: integration
library: autotel-terminal
library_version: "17.0.8"
sources:
  - jagreehal/autotel:packages/autotel-terminal/src/index.tsx
  - jagreehal/autotel:packages/autotel-terminal/src/cli.ts
  - jagreehal/autotel:packages/autotel-terminal/src/streaming-processor.ts
  - jagreehal/autotel:packages/autotel-terminal/src/span-stream.ts
---

# autotel-terminal

React-Ink powered terminal dashboard for viewing autotel OpenTelemetry spans in real-time. Two modes: embedded in your Node.js process via `renderTerminal()`, or standalone OTLP receiver via the `autotel-terminal` CLI.

## Setup

### Embedded mode (in-process)

```typescript
import { init, trace } from 'autotel';
import {
  renderTerminal,
  StreamingSpanProcessor,
  createTerminalSpanStream,
} from 'autotel-terminal';

// Create streaming processor (null = no forwarding, or wrap a BatchSpanProcessor)
const streamingProcessor = new StreamingSpanProcessor(null);

// Initialize autotel with the streaming processor
init({
  service: 'my-app',
  endpoint: 'http://localhost:4318',
  spanProcessors: [streamingProcessor],
});

// Create stream and launch dashboard
const stream = createTerminalSpanStream(streamingProcessor);
renderTerminal({ title: 'My App Traces' }, stream);
```

### Standalone CLI (separate terminal)

```bash
# Start the OTLP receiver dashboard on port 4319
npx autotel-terminal

# Run your app pointing at the dashboard
OTEL_EXPORTER_OTLP_PROTOCOL=http/json \
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4319 \
node app.js
```

## Configuration / Core Patterns

### TerminalOptions

```typescript
renderTerminal(
  {
    title: 'My App Traces',   // Dashboard title
    showStats: true,           // Show span count, error rate, avg duration
    maxSpans: 200,             // Max spans to display (default: 100)
    colors: true,              // Auto-detected from TTY if omitted
    ai: {                      // Optional AI assistant config
      provider: 'ollama',      // 'ollama' | 'openai' | 'openai-compatible'
      model: 'granite4',       // Model name
      apiKey: 'sk-...',        // For cloud providers
      baseUrl: 'http://...',   // Custom endpoint
    },
  },
  stream,
);
```

### StreamingSpanProcessor — wrapping an existing processor

Wrap a `BatchSpanProcessor` so spans go to both the terminal dashboard and your OTLP backend:

```typescript
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { StreamingSpanProcessor, createTerminalSpanStream } from 'autotel-terminal';

const exporter = new OTLPTraceExporter({ url: 'http://localhost:4318/v1/traces' });
const batchProcessor = new BatchSpanProcessor(exporter);
const streamingProcessor = new StreamingSpanProcessor(batchProcessor);

// Subscribe manually (without renderTerminal)
const unsubscribe = streamingProcessor.subscribe((span) => {
  console.log('Span ended:', span.name);
});
// Later: unsubscribe()
```

### Auto-wire shortcut (no stream needed)

If you call `init()` before `renderTerminal()`, autotel-terminal auto-detects the tracer provider:

```typescript
import { init } from 'autotel';
import { renderTerminal } from 'autotel-terminal';

init({ service: 'my-app' });
renderTerminal(); // No stream arg — auto-wires from current tracer provider
```

### CLI options and environment variables

```bash
autotel-terminal \
  --port 4319 \               # env: AUTOTEL_TERMINAL_PORT
  --host 127.0.0.1 \          # env: AUTOTEL_TERMINAL_HOST
  --title "My Dashboard" \    # env: AUTOTEL_TERMINAL_TITLE
  --ai-provider ollama \      # env: AI_PROVIDER
  --ai-model granite4 \       # env: AI_MODEL
  --ai-api-key sk-... \       # env: AI_API_KEY
  --ai-base-url http://...    # env: AI_BASE_URL
```

CLI OTLP endpoints (all accept OTLP JSON format):

| Endpoint | Signal |
|---|---|
| `POST /v1/traces` | Spans streamed into the TUI |
| `POST /v1/logs` | Logs shown in logs view (`l`) |
| `POST /v1/metrics` | Acknowledged and counted |
| `GET /healthz` | Health check |

### AI assistant

Auto-detects Ollama (if running locally) or OpenAI (if `OPENAI_API_KEY` is set). Press `a` in the dashboard to toggle the AI panel. The assistant can answer questions about the spans currently visible in the dashboard.

### Dashboard keyboard controls

| Key | Action |
|---|---|
| `↑/↓` | Navigate |
| `Enter` | Open selected trace (span tree) |
| `Esc` | Back / exit search |
| `t` | Toggle trace view / span list |
| `l` | Toggle logs view |
| `v` | Toggle service summary |
| `E` | Toggle errors view |
| `/` | Search by span name |
| `e` | Toggle error-only filter |
| `p` | Pause / resume live updates |
| `r` | Record snapshot |
| `c` | Clear all spans |
| `J` | Export selected trace as JSON (stdout) |
| `?` | Show help overlay |
| `Ctrl+C` | Exit |

## Common Mistakes

### HIGH — Calling renderTerminal() before init()

Wrong:
```typescript
renderTerminal({}, stream); // stream is empty, no provider wired
init({ service: 'my-app', spanProcessors: [streamingProcessor] });
```

Correct:
```typescript
init({ service: 'my-app', spanProcessors: [streamingProcessor] });
const stream = createTerminalSpanStream(streamingProcessor);
renderTerminal({ title: 'My App' }, stream);
```

Explanation: `init()` must run first so the `StreamingSpanProcessor` is registered with the tracer provider before any spans are created.

### HIGH — Not adding StreamingSpanProcessor to init()

Wrong:
```typescript
const streamingProcessor = new StreamingSpanProcessor(null);
init({ service: 'my-app' }); // streamingProcessor not included
const stream = createTerminalSpanStream(streamingProcessor);
renderTerminal({}, stream); // Dashboard shows nothing
```

Correct:
```typescript
const streamingProcessor = new StreamingSpanProcessor(null);
init({ service: 'my-app', spanProcessors: [streamingProcessor] });
```

Explanation: `StreamingSpanProcessor` must be in the `spanProcessors` list passed to `init()` — it is not registered automatically.

### MEDIUM — Using standard OTLP port 4318 for the CLI

Wrong:
```bash
npx autotel-terminal --port 4318
# Now conflicts with any real OTLP collector also on 4318
```

Correct:
```bash
npx autotel-terminal # Default is 4319, avoids the standard port
```

Explanation: The CLI defaults to port 4319 deliberately so it does not clash with an existing OTLP collector on 4318.

### MEDIUM — Passing full protocol path to OTEL_EXPORTER_OTLP_ENDPOINT

Wrong:
```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4319/v1/traces
```

Correct:
```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4319
# The SDK appends /v1/traces automatically
```

## Version

Targets autotel-terminal v17.0.8. Requires `autotel` (peer), `@opentelemetry/api ^1.9.0`, `@opentelemetry/sdk-trace-base ^2.6.0`. Node.js 22+. Uses Ink v6 / React 19 internally.
