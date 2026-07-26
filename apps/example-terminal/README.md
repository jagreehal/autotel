# Terminal Dashboard Example

This example demonstrates the `autotel-terminal` package - a beautiful, interactive terminal dashboard for viewing OpenTelemetry traces in real-time.

## Features Demonstrated

- **Real-time span streaming** - See traces as they happen
- **Interactive dashboard** - Navigate spans with keyboard controls
- **Error filtering** - Focus on failed operations
- **Live statistics** - Span count, error rate, P95 latency
- **Span details** - View attributes, trace IDs, parent relationships

## Running the Example

From the monorepo root:

```bash
pnpm --filter @jagreehal/example-terminal start
```

Or from this directory:

```bash
pnpm install
pnpm start
```

## Dashboard Controls

Once the dashboard is running, use these keyboard controls:

- **↑/↓** - Navigate through spans
- **`p`** - Pause/resume live updates
- **`e`** - Toggle error-only filter
- **`c`** - Clear all spans
- **Ctrl+C** - Exit dashboard

## How It Works

The example demonstrates the recommended pattern for using `autotel-terminal`:

```typescript
import { init, trace, withTracing, span } from 'autotel';
import {
  renderTerminal,
  StreamingSpanProcessor,
  createTerminalSpanStream,
} from 'autotel-terminal';

// 1. Create a streaming processor for the terminal dashboard
const streamingProcessor = new StreamingSpanProcessor(null);

// 2. Initialize autotel with the streaming processor
init({
  service: 'example-terminal',
  spanProcessors: [streamingProcessor],
});

// 3. Create the stream and launch the dashboard
const terminalStream = createTerminalSpanStream(streamingProcessor);
renderTerminal({ title: 'Example Dashboard' }, terminalStream);

// 4. Your traced code will now appear in the dashboard
const myOperation = withTracing({})((ctx) => async () => {
  ctx.setAttribute('example', 'value');
  // ... your code
});
```

## What You'll See

The example continuously generates traces for:

1. **User fetching** - Simulates API calls to fetch user data
2. **Order processing** - Creates orders with nested spans (inventory validation, total calculation)
3. **Payment processing** - Processes payments (randomly fails to demonstrate error tracking)

The dashboard will show:

- Recent spans in the left panel (color-coded by status)
- Detailed span information in the right panel
- Live statistics at the bottom (total spans, errors, average duration, P95)

## Configuration

Set environment variables to customize the example:

```bash
# OTLP endpoint (optional, defaults to http://localhost:4318)
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

## Example Output

The dashboard will display something like:

```
🔭 Example Terminal Dashboard                    [Live]

↑/↓ select • p pause • e errors-only • c clear • Ctrl+C exit
showing 15/15

┌─────────────────────────────┬──────────────────────────────┐
│ Recent spans                │ Details                      │
├─────────────────────────────┼──────────────────────────────┤
│ › processPayment            │ Name: processPayment         │
│   processOrder              │ Status: OK                    │
│   fetchUser                 │ Duration: 145.23ms           │
│   calculate.total            │ Trace: a1b2c3d4e5             │
│   validate.inventory         │ Span: f6g7h8i9j0             │
│                             │ Attributes:                   │
│                             │   payment.amount: 45         │
│                             │   payment.userId: user-2     │
└─────────────────────────────┴──────────────────────────────┘

Spans: 15 | Errors: 2 | Avg: 125.45ms | P95: 234.12ms
```

## Integration with Observability Backends

The example sends traces to an OTLP endpoint. You can:

1. **Use a local collector** - Run an OpenTelemetry Collector locally
2. **Send to a backend** - Configure endpoint to send to Honeycomb, Datadog, etc.
3. **View in terminal only** - The dashboard works even without an exporter

## Learn More

- [autotel-terminal Documentation](../../packages/autotel-terminal/README.md)
- [autotel Documentation](../../packages/autotel/README.md)
