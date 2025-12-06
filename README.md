# 🔭 autotel

[![npm version](https://img.shields.io/npm/v/autotel.svg?label=autotel)](https://www.npmjs.com/package/autotel)
[![npm subscribers](https://img.shields.io/npm/v/autotel-subscribers.svg?label=adapters)](https://www.npmjs.com/package/autotel-subscribers)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

**Write once, observe everywhere.**

Instrument your Node.js code a single time, keep the DX you love, and stream traces, metrics, logs, and product events to **any** observability stack without vendor lock-in.

**One `init()`, wrap functions with `trace()`, and get automatic traces, metrics, and events:**

```typescript
import { init, trace, track } from 'autotel';
import { PostHogSubscriber, SlackSubscriber } from 'autotel-subscribers';

// Initialize once at startup
init({
  service: 'checkout-api',
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT, // Grafana, Datadog, Tempo, etc.
  subscribers: [
    new PostHogSubscriber({ apiKey: process.env.POSTHOG_KEY! }),
    new SlackSubscriber({ webhookUrl: process.env.SLACK_WEBHOOK! }),
  ],
});

// Wrap any function - automatic spans, error tracking, and context
export const processOrder = trace(async function processOrder(
  orderId: string,
  amount: number,
) {
  const user = await db.users.findById(orderId);
  const payment = await chargeCard(user.cardId, amount);

  // Product events automatically enriched with trace context
  // Sent to: OTLP + PostHog + Slack (all in one call!)
  track('order.completed', { orderId, amount, userId: user.id });

  return payment;
});
```

**That's it.** Every call to `processOrder()` now:

- ✅ Creates a span with automatic error handling
- ✅ Tracks metrics (duration, success rate)
- ✅ Sends events with `traceId` and `spanId` to **all** adapters
- ✅ Works with **any** OTLP-compatible backend (Grafana, Datadog, New Relic, Tempo, etc.)

**[→ See complete examples and API docs](./packages/autotel/README.md#quick-start)**

## Packages

This monorepo contains the following packages:

### [autotel](./packages/autotel)

[![npm](https://img.shields.io/npm/v/autotel.svg)](https://www.npmjs.com/package/autotel)

Core library providing ergonomic OpenTelemetry instrumentation with:

- Drop-in DX with `trace()`, `span()`, and decorators
- Adaptive sampling (10% baseline, 100% errors/slow paths)
- Production hardening (rate limiting, circuit breakers, redaction)
- Auto trace context enrichment
- LLM observability via OpenLLMetry integration
- AI workflow patterns (multi-agent, RAG, evaluation loops)

**[→ View full documentation](./packages/autotel/README.md)**

### [autotel-subscribers](./packages/autotel-subscribers)

[![npm](https://img.shields.io/npm/v/autotel-subscribers.svg)](https://www.npmjs.com/package/autotel-subscribers)

Product events subscribers for:

- PostHog
- Mixpanel
- Amplitude
- Slack webhooks
- Custom webhooks

**[→ View subscribers documentation](./packages/autotel-subscribers/README.md)**

### [autotel-edge](./packages/autotel-edge)

[![npm](https://img.shields.io/npm/v/autotel-edge.svg)](https://www.npmjs.com/package/autotel-edge)

Edge runtime support for:

- Cloudflare Workers
- Vercel Edge Functions
- Other edge environments

**[→ View edge documentation](./packages/autotel-edge/README.md)**

## Migrating from OpenTelemetry?

**[Migration Guide](./docs/MIGRATION.md)** - Migrate from vanilla OpenTelemetry to autotel:

- Quick start with copy-paste code examples
- Pattern-by-pattern transformations (environment variables, manual SDK setup, manual spans, logger integration, sampling)
- Side-by-side before/after comparisons
- 9-phase migration checklist
- Edge cases and when not to migrate

Typical migration: Replace `NODE_OPTIONS` and 30+ lines of SDK boilerplate with `init()`, wrap functions with `trace()` instead of manual `span.start()`/`span.end()`.

## Quick Start

```bash
npm install autotel
# Optional: Add event subscribers (PostHog, Slack, Mixpanel, etc.)
npm install autotel-subscribers
# or
pnpm add autotel
pnpm add autotel-subscribers  # Optional
```

### Quick Debug Mode

See traces instantly during development - perfect for progressive development:

```typescript
import { init, trace } from 'autotel';

// Start with console-only (no backend needed)
init({
  service: 'my-app',
  debug: true  // Outputs spans to console
});

// Your traced functions work as normal
const result = await trace(async () => {
  // Your code here
  return 'success';
})();

// Span printed to console automatically!
```

**How it works:**
- `debug: true` - Print spans to console AND send to backend (if endpoint configured)
  - No endpoint = console-only (perfect for local development)
  - With endpoint = console + backend (verify before choosing provider)
- No debug flag - Send to backend only (default production behavior)

Or use environment variable:
```bash
AUTOTEL_DEBUG=true node server.js
```

### Environment Variables

Configure autotel using standard OpenTelemetry environment variables:

```bash
export OTEL_SERVICE_NAME=my-app
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=YOUR_API_KEY
export OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production
```

Then call `init()` without any config - it picks up env vars automatically:

```typescript
init({ service: 'my-app' }); // Minimal config, env vars fill the rest
```

**[→ See complete environment variable documentation](./packages/autotel/README.md#configuration-reference)**

**[→ Full API documentation](./packages/autotel/README.md)**

## Development

### Prerequisites

- Node.js 18+
- pnpm 8+

### Setup

```bash
# Clone and install dependencies
git clone https://github.com/jagreehal/autotel.git
cd autotel
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Run example apps
pnpm --filter @jagreehal/example-basic start
pnpm --filter @jagreehal/example-http start
```

### Project Structure

```text
autotel/
├── packages/
│   ├── autotel/          # Core library
│   ├── autotel-subscribers/ # Event subscribers
│   └── autotel-edge/     # Edge runtime support
├── apps/
│   ├── example-basic/        # Basic usage example
│   ├── example-http/         # Express server example
│   └── cloudflare-example/   # Cloudflare Workers example
└── turbo.json                # Turborepo configuration
```

### Available Scripts

```bash
# Development
pnpm dev              # Watch mode for all packages
pnpm build            # Build all packages
pnpm test             # Run all tests
pnpm test:integration # Run integration tests

# Code quality
pnpm lint             # Lint all packages
pnpm format           # Format code with Prettier
pnpm type-check       # TypeScript type checking

# Releases
pnpm changeset        # Create a changeset
pnpm version-packages # Version packages
pnpm release          # Publish to npm
```

### Running Examples

#### Basic Example

```bash
pnpm --filter @jagreehal/example-basic start
```

#### HTTP Server Example

```bash
pnpm --filter @jagreehal/example-http start
```

#### Cloudflare Workers Example

```bash
pnpm --filter cloudflare-example dev
```

## Contributing

We welcome contributions! Please see our [contributing guidelines](./CONTRIBUTING.md) for details.

### Development Workflow

1. **Fork and clone** the repository
2. **Create a branch** for your feature: `git checkout -b feature/my-feature`
3. **Make your changes** and add tests
4. **Run tests**: `pnpm test`
5. **Create a changeset**: `pnpm changeset`
6. **Commit your changes**: `git commit -am "Add new feature"`
7. **Push to your fork**: `git push origin feature/my-feature`
8. **Open a pull request**

### Adding a Changeset

We use [changesets](https://github.com/changesets/changesets) for version management:

```bash
pnpm changeset
```

Follow the prompts to:

1. Select which packages changed
2. Choose semver bump (major/minor/patch)
3. Write a summary of your changes

## Architecture

Autotel is built on top of OpenTelemetry and provides:

- **Ergonomic API layer** - Wraps verbose OpenTelemetry APIs
- **Smart defaults** - Production-ready configuration out of the box
- **Platform agnostic** - Works with any OTLP-compatible backend
- **Type-safe** - Full TypeScript support with strict types
- **Modular design** - Use only what you need

## Why Autotel?

| Challenge                           | With autotel                                    |
| ----------------------------------- | --------------------------------------------------- |
| Raw OpenTelemetry is verbose        | One-line `trace()` wrapper with automatic lifecycle |
| Vendor SDKs create lock-in          | OTLP-native, works with any backend                 |
| Need both observability & events | Unified API for traces, metrics, logs, and events   |
| Production safety concerns          | Built-in sampling, rate limiting, redaction         |

## Troubleshooting

Having issues seeing your traces? Use `ConsoleSpanExporter` for visual debugging or `InMemorySpanExporter` for testing. See the [full troubleshooting guide](./packages/autotel/README.md#troubleshooting--debugging) in the detailed docs.

## Roadmap

- [x] Core tracing API
- [x] Metrics support
- [x] Log correlation
- [x] Product events subscribers
- [x] Edge runtime support
- [x] LLM observability (OpenLLMetry)

## Community & Support

- [Report bugs](https://github.com/jagreehal/autotel/issues)
- [Request features](https://github.com/jagreehal/autotel/discussions)
- [Join discussions](https://github.com/jagreehal/autotel/discussions)

## License

MIT - See [LICENSE](./LICENSE) for details.
