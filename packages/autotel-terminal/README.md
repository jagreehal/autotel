# autotel-terminal

**Terminal trace viewer for autotel** — React Ink–powered dashboard for live trace inspection during development. Zero setup, trace-first, autotel-only.

[![npm version](https://badge.fury.io/js/autotel-terminal.svg)](https://www.npmjs.com/package/autotel-terminal)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

`autotel-terminal` is a terminal-native trace viewer for **autotel**. It streams OpenTelemetry spans from your app and shows them as traces: recent traces list, span tree per trace, search, and a simple waterfall. Built for local development—no browser, no extra backends.

### Features

- ✅ **Trace-first UI** — Recent traces list; open a trace to see its span tree (parent/child)
- ✅ **Real-time streaming** — Spans appear as they complete; optional pause/resume
- ✅ **Search** — Filter by span name (`/`); combine with error-only filter (`e`)
- ✅ **Span details** — Key attributes first (e.g. `http.route`, `db.operation`); full list + waterfall for selected trace
- ✅ **Relative time & errors** — "2s ago" labels; error badge and new-error indicator
- ✅ **Help overlay** — `?` shows all shortcuts
- ✅ **Simple setup** — Add `StreamingSpanProcessor` to autotel and call `renderTerminal()`

## Installation

```bash
npm install autotel-terminal autotel
# or
pnpm add autotel-terminal autotel
# or
yarn add autotel-terminal autotel
```

## Quick Start

### Recommended Usage

Create a `StreamingSpanProcessor` and pass it to `init()`, then use `renderTerminal()` with the stream:

```typescript
import { init, trace } from 'autotel';
import {
  renderTerminal,
  StreamingSpanProcessor,
  createTerminalSpanStream,
} from 'autotel-terminal';

// Create streaming processor for the terminal dashboard
const streamingProcessor = new StreamingSpanProcessor(null);

// Initialize autotel with the streaming processor
init({
  service: 'my-app',
  endpoint: 'http://localhost:4318',
  spanProcessors: [streamingProcessor],
});

// Create the stream and launch the dashboard
const terminalStream = createTerminalSpanStream(streamingProcessor);
renderTerminal({ title: 'My App Traces' }, terminalStream);

// Your traced code will now appear in the dashboard
const myFunction = trace((ctx) => async () => {
  ctx.setAttribute('example', 'value');
  // ... your code
});

await myFunction();
```

### With Backend Export

To stream to the terminal AND export to a backend (e.g., Jaeger, OTLP collector):

```typescript
import { init } from 'autotel';
import {
  StreamingSpanProcessor,
  createTerminalSpanStream,
  renderTerminal,
} from 'autotel-terminal';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

// Create exporter and base processor for your backend
const exporter = new OTLPTraceExporter({ url: 'http://localhost:4318/v1/traces' });
const batchProcessor = new BatchSpanProcessor(exporter);

// Create streaming processor that wraps your batch processor
// Spans are forwarded to both the dashboard AND the backend
const streamingProcessor = new StreamingSpanProcessor(batchProcessor);

// Initialize autotel
init({
  service: 'my-app',
  spanProcessors: [streamingProcessor],
});

// Create stream and launch dashboard
const stream = createTerminalSpanStream(streamingProcessor);
renderTerminal({ title: 'My App Traces' }, stream);
```

### With Custom Options

```typescript
renderTerminal(
  {
    title: 'My App Traces',
    showStats: true,
    maxSpans: 200,
    colors: true, // Auto-detected if TTY
  },
  stream,
);
```

## Dashboard Controls

Once the dashboard is running, use these keyboard controls:

- **↑/↓** - Navigate traces or spans
- **Enter** - Open selected trace (trace view) to see span tree
- **Esc** - Back to trace list or exit search
- **`t`** - Toggle trace view / span list
- **`/`** - Search by span name (type to filter)
- **`p`** - Pause/resume live updates
- **`e`** - Toggle error-only filter
- **`c`** - Clear all spans
- **`?`** - Show help overlay
- **Ctrl+C** - Exit dashboard

## Dashboard Features

### Trace View (default)

The left panel shows **recent traces** (grouped by trace ID):
- Root span name, duration, trace ID (short), relative time ("2s ago")
- Error badge when any span in the trace failed
- **Enter** to open a trace and see its **span tree** (ASCII parent-child: ├──, └──)
- **Esc** to go back to the trace list

### Span List (toggle with `t`)

Flat list of recent spans with:
- Span name (truncated), duration (color-coded: green < 500ms, yellow > 500ms, red = error)
- Relative time
- Selection indicator (cyan `›`)

### Search

Press **`/`** to filter by span name. Type to narrow; **Esc** to clear.

### Span Details

The right panel shows detailed information for the selected span:
- Name, status, duration (with "Nx avg" when slower than average for that span name)
- Trace ID, Span ID, Parent Span ID
- Span kind (INTERNAL, SERVER, CLIENT, etc.)
- **Key attributes** (http.route, db.operation, code.function, etc.) first
- Remaining attributes
- **Waterfall** for the selected trace (when a trace is open): horizontal bars by duration

### Statistics Bar

When enabled, shows:
- Total spans
- Error count
- Average duration
- P95 latency

## API Reference

### `renderTerminal(options?, stream?)`

Render the terminal dashboard.

**Parameters:**

- `options` - Optional dashboard configuration
- `stream` - The terminal span stream (from `createTerminalSpanStream`)

**Options:**

```typescript
interface TerminalOptions {
  /** Dashboard title (default: 'Autotel Trace Inspector') */
  title?: string;

  /** Show statistics bar (default: true) */
  showStats?: boolean;

  /** Maximum number of spans to display (default: 100) */
  maxSpans?: number;

  /** Enable colors (default: true if TTY) */
  colors?: boolean;
}
```

**Example:**

```typescript
renderTerminal(
  {
    title: 'API Server Traces',
    showStats: true,
    maxSpans: 200,
  },
  stream,
);
```

### `StreamingSpanProcessor`

A span processor that emits completed spans to subscribers. Can wrap another processor or work standalone.

```typescript
import { StreamingSpanProcessor } from 'autotel-terminal';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';

// Standalone (no forwarding)
const streamingProcessor = new StreamingSpanProcessor(null);

// Or wrap an existing processor (spans forwarded to both)
const batchProcessor = new BatchSpanProcessor(exporter);
const streamingProcessor = new StreamingSpanProcessor(batchProcessor);

// Subscribe to spans directly (alternative to using createTerminalSpanStream)
const unsubscribe = streamingProcessor.subscribe((span) => {
  console.log('Span ended:', span.name);
});

// Later, unsubscribe
unsubscribe();
```

**Constructor:**

```typescript
new StreamingSpanProcessor(wrappedProcessor?: SpanProcessor | null)
```

- `wrappedProcessor` - Optional processor to wrap. If provided, spans are forwarded to it. If `null`, spans are only emitted to subscribers.

**Methods:**

- `subscribe(callback: (span: ReadableSpan) => void): () => void` - Subscribe to span end events. Returns unsubscribe function.
- `forceFlush(): Promise<void>` - Flush wrapped processor (if any).
- `shutdown(): Promise<void>` - Shutdown processor and clear subscribers.

### `createTerminalSpanStream(processor)`

Create a terminal-compatible stream from a `StreamingSpanProcessor`.

```typescript
import { createTerminalSpanStream, StreamingSpanProcessor } from 'autotel-terminal';

const processor = new StreamingSpanProcessor(null);
const stream = createTerminalSpanStream(processor);

// Subscribe to span events
stream.onSpanEnd((event) => {
  console.log('Span:', event.name, event.durationMs + 'ms');
});
```

**Returns:** `TerminalSpanStream` with `onSpanEnd(callback)` method.

**Event Format:**

```typescript
interface TerminalSpanEvent {
  name: string;
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  status: 'OK' | 'ERROR' | 'UNSET';
  kind?: string;
  attributes?: Record<string, unknown>;
}
```

## Use Cases

### Development Debugging

Perfect for debugging during development - see traces in real-time without leaving your terminal:

```typescript
import { init } from 'autotel';
import {
  StreamingSpanProcessor,
  createTerminalSpanStream,
  renderTerminal,
} from 'autotel-terminal';

const streamingProcessor = new StreamingSpanProcessor(null);

init({
  service: 'dev-server',
  spanProcessors: [streamingProcessor],
});

const stream = createTerminalSpanStream(streamingProcessor);
renderTerminal({ title: 'Dev Server Traces' }, stream);
```

### Testing

Use the streaming processor to assert on spans in tests:

```typescript
import { StreamingSpanProcessor, createTerminalSpanStream } from 'autotel-terminal';
import { init } from 'autotel';

const processor = new StreamingSpanProcessor(null);
const stream = createTerminalSpanStream(processor);

init({
  service: 'test',
  spanProcessors: [processor],
});

// Collect spans
const spans: TerminalSpanEvent[] = [];
stream.onSpanEnd((span) => spans.push(span));

// Run your code
await myFunction();

// Assert on spans
expect(spans).toHaveLength(1);
expect(spans[0].name).toBe('myFunction');
```

### Custom Dashboards

Build your own dashboard using the streaming processor:

```typescript
import { StreamingSpanProcessor, createTerminalSpanStream } from 'autotel-terminal';

const processor = new StreamingSpanProcessor(null);
const stream = createTerminalSpanStream(processor);

stream.onSpanEnd((event) => {
  // Send to your custom dashboard
  myCustomDashboard.addSpan(event);
});
```

## Integration with autotel

`autotel-terminal` is built for **autotel**. It auto-wires to the global tracer provider and expects `StreamingSpanProcessor` in your `spanProcessors` array:

```typescript
import { init } from 'autotel';
import {
  StreamingSpanProcessor,
  createTerminalSpanStream,
  renderTerminal,
} from 'autotel-terminal';

const streamingProcessor = new StreamingSpanProcessor(null);

init({
  service: 'my-app',
  endpoint: 'http://localhost:4318',
  spanProcessors: [streamingProcessor],
});

const stream = createTerminalSpanStream(streamingProcessor);
renderTerminal({}, stream);
```

## Requirements

- Node.js 22+
- Terminal with TTY support (for colors and interactivity)
- `autotel` package (peer dependency)

## Bundle Size

- **Core dashboard**: ~25KB minified
- **With dependencies** (ink, react): ~150KB total
- **Development tool** - not intended for production bundles

## Limitations

- **Development only** — Not designed for production use
- **TTY required** — Colors and interactivity require a terminal
- **Memory** — Keeps spans in memory (limited by `maxSpans` option)
- **Single instance** — Only one dashboard can run at a time

## Manual verification

When testing the dashboard (e.g. with `example-terminal` or your app), you can verify:

- **Trace list** — Trigger some traced work; recent traces appear with root span name, duration, relative time
- **Trace tree** — Select a trace and press Enter; span tree shows with indented children
- **Search** — Press `/`, type a span name; list filters; Esc clears
- **Errors** — Press `e` for error-only filter; traces with failed spans show an error badge
- **Help** — Press `?` to see all shortcuts
- **Waterfall** — With a trace open, the details panel shows a simple duration waterfall
- **Key attributes** — In span details, `http.route`, `db.operation`, `code.function`, etc. appear first

## Examples

See the [autotel examples](../../apps/) directory for complete working examples:

- `apps/example-terminal` - Terminal dashboard with live trace viewing

## License

MIT © [Jag Reehal](https://github.com/jagreehal)

## Links

- [GitHub Repository](https://github.com/jagreehal/autotel)
- [Documentation](https://github.com/jagreehal/autotel#readme)
- [Issues](https://github.com/jagreehal/autotel/issues)



