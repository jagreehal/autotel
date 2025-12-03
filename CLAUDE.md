# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Autotel is a monorepo containing multiple packages that provide ergonomic OpenTelemetry instrumentation for Node.js and edge runtimes. The core philosophy is "Write once, observe everywhere" - instrument code a single time and stream observability data to any OTLP-compatible backend without vendor lock-in.

## Package Architecture

### `packages/autotel` (Node.js Core)
The main package providing OpenTelemetry instrumentation with an ergonomic functional API for Node.js runtimes. Key concepts:

- **Functional API**: Primary interface using `trace()`, `span()`, and `instrument()` functions that wrap business logic with automatic span lifecycle management
- **Dual Configuration System**:
  - `init()` sets up global OpenTelemetry SDK (service name, exporters, resource detection)
  - `getConfig()` provides runtime configuration for sampling, rate limiting, circuit breakers
- **Production Hardening**: Built-in rate limiters, circuit breakers, and PII redaction
- **Adaptive Sampling**: Defaults to 10% baseline sampling, 100% for errors/slow operations (tail sampling)
- **Events Integration**: Unified API to send product events to any platform via adapters
- **Multiple Entry Points**: Package uses explicit exports (check `package.json` exports field) for tree-shaking:
  - `autotel` - Core trace/span/init functions
  - `autotel/logger` - Pino integration
  - `autotel/events` - Events API
  - `autotel/metrics` - Metrics helpers
  - `autotel/testing` - Test utilities
  - And more (see package.json exports)

### `packages/autotel-subscribers`
Event subscribers for product events platforms (PostHog, Mixpanel, Amplitude, Segment, webhooks). All adapters extend `EventSubscriber` base class which provides:
- Error handling and retry logic
- Graceful shutdown with pending request tracking
- Consistent payload normalization
- Tree-shakeable exports (each adapter is a separate entry point)

### `packages/autotel-edge` (Vendor-Agnostic Edge Foundation)
**NEW:** Vendor-agnostic OpenTelemetry foundation for edge runtimes. Bundle size optimized (~20KB vs 700KB for Node.js version). Provides:

- **Core Functionality**: TracerProvider, OTLP exporter, context management
- **Functional API**: Same `trace()`, `span()`, `instrument()` API as Node.js version
- **Sampling Strategies**: Adaptive, error-only, slow-only, custom samplers
- **Events System**: Product analytics with trace correlation
- **Zero-Dependency Logger**: Trace-aware logging
- **Testing Utilities**: Test harnesses and assertion helpers
- **Tree-Shakeable Entry Points**:
  - `autotel-edge` - Core functional API
  - `autotel-edge/sampling` - Sampling strategies
  - `autotel-edge/events` - Events system
  - `autotel-edge/logger` - Logger
  - `autotel-edge/testing` - Testing utilities

**Supported Runtimes:** Cloudflare Workers (via autotel-cloudflare), Vercel Edge, Netlify Edge, Deno Deploy, or any edge runtime with fetch() and AsyncLocalStorage.

### `packages/autotel-cloudflare` (Cloudflare Workers Complete)
**NEW:** Complete OpenTelemetry solution for Cloudflare Workers. Built on autotel-edge with Cloudflare-specific features:

- **Native CF OTel Integration**: Works with Cloudflare's native observability (wrangler.toml destinations)
- **Complete Bindings Coverage**: Auto-instruments KV, R2, D1, Durable Objects, Workflows, Workers AI, Vectorize, Hyperdrive, Service Bindings, Queue, Analytics Engine, and Email
- **Multiple API Styles**:
  - `instrument(handler, config)` - Compatible with @microlabs/otel-cf-workers
  - `wrapModule(config, handler)` - Compatible with workers-honeycomb-logger
  - `wrapDurableObject(config, DOClass)` - Durable Objects instrumentation
  - Functional API via re-exports from autotel-edge
- **Handler Instrumentation**: Automatic tracing for fetch, scheduled, queue, email handlers
- **Global Instrumentations**: Auto-instrument global fetch() and cache API
- **Tree-Shakeable Entry Points**:
  - `autotel-cloudflare` - Everything (wrappers + re-exports from autotel-edge)
  - `autotel-cloudflare/bindings` - Just bindings instrumentation
  - `autotel-cloudflare/handlers` - Just handler wrappers
  - `autotel-cloudflare/sampling` - Re-export from autotel-edge
  - `autotel-cloudflare/events` - Re-export from autotel-edge
  - `autotel-cloudflare/logger` - Re-export from autotel-edge
  - `autotel-cloudflare/testing` - Re-export from autotel-edge

**Bundle Size:** ~45KB total (autotel-edge 20KB + CF-specific 25KB)

**Why Better than Competitors:**
- More complete than @microlabs/otel-cf-workers (which lacks R2, AI, Vectorize, Hyperdrive)
- Vendor-agnostic unlike workers-honeycomb-logger (works with any OTLP backend)
- Multiple API styles for maximum flexibility
- Advanced sampling strategies

### `packages/autotel-mcp` (Model Context Protocol)
**NEW:** OpenTelemetry instrumentation for Model Context Protocol (MCP) with distributed tracing. Enables automatic tracing of MCP servers and clients using W3C Trace Context propagation via the `_meta` field.

- **Automatic Instrumentation**: One function call to instrument all tools, resources, and prompts
- **Distributed Tracing**: W3C Trace Context propagation through `_meta` field (traceparent, tracestate, baggage)
- **Transport-Agnostic**: Works with stdio, HTTP, SSE, or any MCP transport (context in JSON payload, not headers)
- **Proxy-Based Pattern**: Similar to autotel-cloudflare bindings instrumentation (no MCP SDK modifications)
- **Runtime Support**: Both Node.js (autotel) and Edge (autotel-edge)
- **Tree-Shakeable Entry Points**:
  - `autotel-mcp` - Everything (server + client + context utilities)
  - `autotel-mcp/server` - Server instrumentation only (~5KB)
  - `autotel-mcp/client` - Client instrumentation only (~4KB)
  - `autotel-mcp/context` - Context utilities only (~2KB)

**Bundle Size:** ~7KB total (context 2KB + server 3KB + client 2KB)

**Key Implementation Details:**
- Uses Proxy pattern to wrap `registerTool()`, `registerResource()`, `registerPrompt()` on server
- Uses Proxy pattern to wrap `callTool()`, `getResource()`, `getPrompt()` on client
- Server extracts parent context from `_meta` field using `extractOtelContextFromMeta()`
- Client injects current context into `_meta` field using `injectOtelContextToMeta()`
- Runtime detection auto-imports from `autotel` or `autotel-edge` as needed
- Requires MCP SDK v1.0.0+ (which uses Zod v3 - autotel doesn't use Zod so no conflict)

**Why Better than Manual Instrumentation:**
- No need to manually wrap each tool handler
- Automatic parent-child span relationships across client-server boundaries
- Transport-agnostic (works with any MCP transport, not just HTTP)
- Consistent span naming and attributes

### `packages/autotel-tanstack` (TanStack Start)
**NEW:** OpenTelemetry instrumentation for TanStack Start applications. Provides automatic tracing for server functions, middleware, and route loaders.

- **Middleware-Based API**: Aligns with TanStack's middleware pattern for seamless integration
- **Server Function Tracing**: Automatic spans for `createServerFn()` calls with argument/result capture
- **Route Loader Tracing**: Trace `loader()` and `beforeLoad()` functions with route context
- **Handler Wrapper**: Wrap `createStartHandler()` for complete request tracing
- **Distributed Tracing**: W3C Trace Context propagation via headers (traceparent, tracestate, baggage)
- **Zero-Config Mode**: Just `import 'autotel-tanstack/auto'` to enable tracing
- **Tree-Shakeable Entry Points**:
  - `autotel-tanstack` - Everything (convenience re-exports)
  - `autotel-tanstack/auto` - Zero-config auto-instrumentation
  - `autotel-tanstack/middleware` - Middleware integration
  - `autotel-tanstack/server-functions` - Server function wrappers
  - `autotel-tanstack/loaders` - Route loader instrumentation
  - `autotel-tanstack/handlers` - Handler wrappers
  - `autotel-tanstack/context` - Context propagation utilities
  - `autotel-tanstack/testing` - Test utilities

**Bundle Size:** ~25KB total

**Key APIs:**

```typescript
// Middleware approach (recommended)
import { tracingMiddleware } from 'autotel-tanstack/middleware';

export const startInstance = createStart(() => ({
  requestMiddleware: [tracingMiddleware()],
}));

// Server function middleware
export const getUser = createServerFn({ method: 'GET' })
  .middleware([tracingMiddleware({ type: 'function' })])
  .handler(async ({ data: id }) => {
    return await db.users.findUnique({ where: { id } });
  });
```

```typescript
// Explicit wrappers
import { traceServerFn } from 'autotel-tanstack/server-functions';
import { traceLoader } from 'autotel-tanstack/loaders';

export const getUser = traceServerFn(
  createServerFn({ method: 'GET' }).handler(async ({ data }) => { ... }),
  { name: 'getUser' }
);

export const Route = createFileRoute('/users/$userId')({
  loader: traceLoader(async ({ params }) => { ... }),
});
```

```typescript
// Handler wrapper (full control)
import { wrapStartHandler } from 'autotel-tanstack/handlers';

export default wrapStartHandler({
  service: 'my-app',
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
})(createStartHandler(defaultStreamHandler));
```

```typescript
// Zero-config (env var configuration)
import 'autotel-tanstack/auto';
// Set OTEL_SERVICE_NAME, OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS
```

**Span Attributes:**
- HTTP: `http.request.method`, `url.path`, `http.response.status_code`
- Server Functions: `rpc.method`, `tanstack.server_function.name`
- Loaders: `tanstack.loader.route_id`, `tanstack.loader.type`

**Framework Support:** Both TanStack React Start and Solid Start

## Environment Variables

Autotel supports standard OpenTelemetry environment variables for configuration. This enables zero-code configuration changes across environments and compatibility with the broader OTEL ecosystem.

### Supported Environment Variables

**Service Configuration:**
- `OTEL_SERVICE_NAME` - Service name (maps to `service` in `init()`)

**Exporter Configuration:**
- `OTEL_EXPORTER_OTLP_ENDPOINT` - OTLP collector URL (maps to `endpoint`)
  - Examples: `http://localhost:4318`, `https://api.honeycomb.io`
- `OTEL_EXPORTER_OTLP_PROTOCOL` - Protocol to use: `http` or `grpc` (maps to `protocol`)
- `OTEL_EXPORTER_OTLP_HEADERS` - Authentication headers as comma-separated key=value pairs
  - Format: `key1=value1,key2=value2`
  - Example: `x-honeycomb-team=YOUR_API_KEY`

**Resource Attributes:**
- `OTEL_RESOURCE_ATTRIBUTES` - Custom metadata tags as comma-separated key=value pairs
  - Common attributes: `service.version`, `deployment.environment`, `team`, `region`
  - Example: `service.version=1.0.0,deployment.environment=production`

### Configuration Precedence

Configuration is resolved in the following priority order (highest to lowest):

1. **Explicit `init()` parameters** - Direct code configuration
2. **YAML file** - `autotel.yaml` or `AUTOTEL_CONFIG_FILE` env var
3. **Environment variables** - `OTEL_*`, `AUTOTEL_*` env vars
4. **Built-in defaults** - Sensible defaults for development

```typescript
// Explicit config takes precedence over YAML and env vars
init({
  service: 'my-service',  // Overrides YAML and OTEL_SERVICE_NAME
  endpoint: 'http://localhost:4318'  // Overrides YAML and OTEL_EXPORTER_OTLP_ENDPOINT
})
```

### YAML Configuration

Autotel supports YAML file configuration for a declarative setup without code changes. Create an `autotel.yaml` file in your project root:

```yaml
# autotel.yaml
service:
  name: my-service
  version: 1.0.0
  environment: ${env:NODE_ENV:-development}

exporter:
  endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT:-http://localhost:4318}
  protocol: http
  headers:
    x-honeycomb-team: ${env:HONEYCOMB_API_KEY}

resource:
  deployment.environment: ${env:NODE_ENV:-development}
  team: backend

autoInstrumentations:
  - express
  - http
  - pino

debug: false
```

**Key features:**
- **Auto-discovery**: Automatically loads `autotel.yaml` or `autotel.yml` from the current directory
- **Explicit path**: Set `AUTOTEL_CONFIG_FILE=./config/otel.yaml` to use a custom path
- **Environment variable substitution**: Use `${env:VAR_NAME}` or `${env:VAR_NAME:-default}` in YAML values
- **Programmatic loading**: Use `loadYamlConfigFromFile()` from `autotel/yaml` for custom loading

**Usage with autotel/auto (zero-config):**
```bash
# Just create autotel.yaml and run:
tsx --import autotel/auto src/index.ts
```

**Programmatic loading:**
```typescript
import { loadYamlConfigFromFile } from 'autotel/yaml';
import { init } from 'autotel';

const yamlConfig = loadYamlConfigFromFile('./config/otel.yaml');
init({ ...yamlConfig, debug: true });
```

See `packages/autotel/autotel.yaml.example` for a complete template.

### Example Usage

**Development (local collector):**
```bash
export OTEL_SERVICE_NAME=my-app
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

**Production (Honeycomb):**
```bash
export OTEL_SERVICE_NAME=my-app
export OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io
export OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=YOUR_API_KEY
export OTEL_RESOURCE_ATTRIBUTES=service.version=1.2.3,deployment.environment=production
```

**Production (Datadog):**
```bash
export OTEL_SERVICE_NAME=my-app
export OTEL_EXPORTER_OTLP_ENDPOINT=https://http-intake.logs.datadoghq.com
export OTEL_EXPORTER_OTLP_HEADERS=DD-API-KEY=YOUR_API_KEY
export OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production,team=backend
```

See `packages/autotel/.env.example` for a complete template.

### Implementation Details

**Environment variable resolution** is handled in `packages/autotel/src/env-config.ts`. The resolver:
- Validates env var formats (URLs, enum values)
- Parses complex values (comma-separated key=value pairs)
- Provides type-safe config objects

**YAML configuration** is handled in `packages/autotel/src/yaml-config.ts`. The loader:
- Auto-discovers `autotel.yaml` or `autotel.yml` in the current directory
- Supports `AUTOTEL_CONFIG_FILE` env var for custom paths
- Substitutes `${env:VAR}` and `${env:VAR:-default}` syntax in YAML values
- Converts YAML structure to `AutotelConfig` type

**Config merging** happens in `init()` with the priority: `explicit > yaml > env > defaults`

## Development Commands

### Building
```bash
pnpm build              # Build all packages (uses Turborepo)
pnpm dev                # Watch mode for all packages
```

### Testing
```bash
# Run all tests (unit + integration)
pnpm test

# Package-specific testing (in package directory)
pnpm test               # Unit tests only (vitest.unit.config.ts)
pnpm test:watch         # Unit tests in watch mode
pnpm test:integration   # Integration tests (vitest.integration.config.ts)

# Run single test file
npx vitest run src/functional.test.ts
```

**Important**: The core `autotel` package has separate unit and integration test configs:
- `vitest.unit.config.ts` - Excludes `*.integration.test.ts` files
- `vitest.integration.config.ts` - Only runs `*.integration.test.ts` files

### Linting & Formatting
```bash
pnpm lint               # Lint all packages (ESLint)
pnpm format             # Format with Prettier
pnpm type-check         # TypeScript type checking
```

### Quality Check
```bash
pnpm quality            # Runs: build + lint + format + type-check + test + test:integration
```

### Running Examples
```bash
# Basic example (demonstrates trace() usage)
pnpm --filter @jagreehal/example-basic start

# HTTP server example
pnpm --filter @jagreehal/example-http start

# Cloudflare Workers example
pnpm --filter cloudflare-example dev
```

### Changesets (Version Management)
```bash
pnpm changeset          # Create a changeset for your changes
pnpm version-packages   # Bump versions based on changesets
pnpm release            # Build and publish to npm
```

When creating changesets:
- Select affected packages (autotel, autotel-subscribers, autotel-edge)
- Choose semver bump: patch (bug fixes), minor (new features), major (breaking changes)
- Write clear summary for CHANGELOG

## Code Structure Patterns

### Functional API Pattern (`packages/autotel/src/functional.ts`)
The core `trace()` function uses a factory pattern to detect if the user is passing a function that needs a context parameter:

```typescript
// Factory pattern (receives ctx)
export const createUser = trace(ctx => async (data) => {
  ctx.setAttribute('user.id', data.id)
  return await db.users.create(data)
})

// Direct pattern (no ctx needed)
export const getUser = trace(async (id) => {
  return await db.users.findById(id)
})
```

The implementation auto-detects the pattern by analyzing the function signature and checking the first parameter name against known hints (`ctx`, `context`, `tracecontext`, etc.).

#### Trace Name Inference

Trace names are inferred automatically with the following priority:
1. **Explicit name** (from `trace('customName', ...)` or `instrument()` key)
2. **Named function expressions** (e.g., `trace((ctx) => async function createUser() {})`)
3. **Variable name from assignment** (e.g., `const processDocuments = trace(...)` → "processDocuments")
4. **Factory function name** (if the outer function is named)

The variable name inference (priority #3) works by analyzing the call stack to find the source line where `trace()` is called, then parsing it to extract the variable name from const/let/var assignments. This is especially useful for arrow functions in the factory pattern:

```typescript
// Arrow function with inferred name from const assignment
export const processDocuments = trace((ctx) => async (data: string) => {
  ctx.setAttribute('document.count', data.length)
  return data.toUpperCase()
})
// Trace name: "processDocuments" (inferred from const)

// Named function expression (takes precedence)
export const processDocuments = trace((ctx) => async function processData(data: string) => {
  return data.toUpperCase()
})
// Trace name: "processData" (from named function, not "processDocuments")
```

**Limitations:**
- Minified/obfuscated code may prevent name inference
- Edge runtimes without file system access will fall back to unnamed spans
- Results are cached per source location for performance

### Events Queue Pattern (`packages/autotel/src/events-queue.ts`)
Events events use an async queue to prevent blocking the main execution path:
- Events are queued immediately and returned
- Background worker processes queue and sends to all configured adapters
- Adapters can implement batching/buffering independently
- Shutdown waits for queue to drain

### Configuration Layering
Two separate config systems serve different purposes:
1. **Init Config** (`init.ts`): Global OpenTelemetry SDK setup (resource, exporters, instrumentations)
2. **Runtime Config** (`config.ts`): Per-operation configuration (sampling rates, rate limits, circuit breaker thresholds)

### Tail Sampling Processor (`packages/autotel/src/tail-sampling-processor.ts`)
Implements deferred sampling decisions:
- Spans are buffered in-memory during execution
- Sampling decision made after span ends (can inspect attributes, status, duration)
- Default `AdaptiveSampler`: 10% baseline, 100% errors, 100% slow requests
- Custom samplers can implement `Sampler` interface

## Testing Patterns

### OpenTelemetry Utilities - Semantic Module Organization

Autotel re-exports commonly-needed OpenTelemetry utilities in semantically-organized modules. These are already included in autotel's dependencies, so **no additional installation is required**.

**Module Organization:**

**`autotel/exporters`** - Span exporters for development and testing:
- `ConsoleSpanExporter` - Print spans to console (development debugging, examples)
- `InMemorySpanExporter` - Collect spans in memory (testing, assertions)

**`autotel/processors`** - Span processors for custom configurations:
- `SimpleSpanProcessor` - Synchronous span processing (testing, immediate export)
- `BatchSpanProcessor` - Async batching (production, custom configs)

**`autotel/testing`** - High-level testing utilities with assertions:
- `createTraceCollector()` - Auto-configured trace collector with helpers
- `assertTraceCreated()`, `assertTraceSucceeded()`, `assertTraceFailed()`, etc.
- Events and metrics testing utilities

**Why re-export?** Achieves "one install is all you need" DX without bundle size impact (these are from `@opentelemetry/sdk-trace-base`, already a dependency).

```typescript
// Development debugging - see spans in console
import { init } from 'autotel'
import { ConsoleSpanExporter } from 'autotel/exporters'

init({
  service: 'my-app',
  spanExporters: [new ConsoleSpanExporter()],
})

// Low-level testing - collect raw OTel spans
import { init } from 'autotel'
import { InMemorySpanExporter } from 'autotel/exporters'
import { SimpleSpanProcessor } from 'autotel/processors'

const exporter = new InMemorySpanExporter()
init({
  service: 'test',
  spanProcessors: [new SimpleSpanProcessor(exporter)],
})

// Run code under test
await myFunction()

// Assert on collected spans
const spans = exporter.getFinishedSpans()
expect(spans).toHaveLength(1)
```

**Note:** For most testing scenarios, prefer autotel's high-level `createTraceCollector()` utility from `autotel/testing` which provides assertion helpers and automatic tracer configuration.

### Test Harnesses
Use provided test harnesses for consistent testing:

```typescript
// Event subscribers
import { SubscriberTestHarness } from 'autotel-subscribers/testing'

const harness = new SubscriberTestHarness(new MySubscriber(config))
await harness.testBasicEvent()
await harness.testErrorHandling()

// High-level trace testing (recommended)
import { createTraceCollector, assertTraceCreated } from 'autotel/testing'

const collector = createTraceCollector()
await myService.doSomething()
assertTraceCreated(collector, 'myService.doSomething')

// Low-level testing (when you need raw OTel spans)
import { InMemorySpanExporter } from 'autotel/exporters'
import { SimpleSpanProcessor } from 'autotel/processors'

const exporter = new InMemorySpanExporter()
// Use in tests to capture raw spans
```

### Integration Tests
Integration tests require OpenTelemetry SDK setup, so they're isolated in `*.integration.test.ts` files and run with a separate vitest config.

## Important Patterns & Conventions

### Tree-Shaking & Bundle Size
All packages are configured for aggressive tree-shaking:
- Use `"sideEffects": false` in package.json
- Export all public APIs explicitly in package.json `exports` field
- Keep dependencies minimal (especially in autotel-edge)
- External dependencies (pino, winston) are marked as peer/optional

### TypeScript Decorators
The codebase uses TypeScript 5.0+ decorators (not experimental legacy decorators). Test execution uses `tsx` which supports the new decorator syntax. The `decorators.ts` module provides `@Trace` decorator for class methods.

### OpenTelemetry Context Propagation
The library uses standard OpenTelemetry context propagation:
- Active context is stored in AsyncLocalStorage (Node.js) or async context (edge)
- `trace()` automatically creates child spans in the active context
- Use `withNewContext()` to create isolated trace trees
- Context includes custom attributes via `runInOperationContext()`

### Dynamic Module Loading (CJS/ESM Compatibility)
**Never use `await import()` for dynamic module loading.** Instead, use the `node-require` helper functions from `./node-require`:

```typescript
// ❌ DON'T: Using async import()
const mod = await import('some-module');

// ✅ DO: Use node-require helpers
import { safeRequire, requireModule } from './node-require';

// For optional dependencies (returns undefined if missing)
const traceloop = safeRequire('@traceloop/node-server-sdk');
if (traceloop) {
  traceloop.initialize({ ... });
}

// For required dependencies (throws if missing)
const fs = requireModule<typeof import('node:fs')>('node:fs');
const content = fs.readFileSync('file.txt', 'utf8');
```

**Why?**
- `init()` and other core functions must remain **synchronous**
- `await import()` makes functions async, breaking the API contract
- The `node-require` helper uses `createRequire()` pattern for ESM compatibility
- Works in both CJS and ESM builds (tsup handles the differences)
- Consistent, synchronous module loading across the codebase

**Implementation:** See `packages/autotel/src/node-require.ts` for details.

### Advanced Features (v1.1.0+)

#### Deterministic Trace IDs
Generate consistent trace IDs from seeds for correlation with external systems:

```typescript
import { createDeterministicTraceId } from 'autotel/trace-helpers'

// Generate trace ID from external request ID
const requestId = req.headers['x-request-id']
const traceId = await createDeterministicTraceId(requestId)

// Use for correlation in support tickets, external systems, etc.
console.log(`View traces: https://your-backend.com/traces/${traceId}`)
```

**Implementation:** Uses SHA-256 hashing to generate consistent 128-bit trace IDs. Works in Node.js and edge runtimes (via crypto.subtle).

**Use cases:**
- Correlate external request IDs with OTel traces
- Link support tickets to trace data
- Associate business entities (orders, sessions) with observability data

#### Metadata Flattening
Automatically flatten nested objects into dot-notation span attributes:

```typescript
import { flattenMetadata } from 'autotel/trace-helpers'
import { trace } from 'autotel'

export const processOrder = trace(ctx => async (order: Order) => {
  const metadata = flattenMetadata({
    user: { id: order.userId, tier: 'premium' },
    payment: { method: 'card', processor: 'stripe' },
    items: order.items.length
  })

  ctx.setAttributes(metadata)
  // Results in: metadata.user.id, metadata.user.tier, metadata.payment.method, etc.
})
```

**Features:**
- Auto-serializes non-string values to JSON
- Filters out null/undefined values
- Gracefully handles circular references (→ `<serialization-failed>`)
- Customizable prefix (default: `'metadata'`)

#### Isolated Tracer Provider
For library authors who want to use Autotel without interfering with the application's global OTel setup:

```typescript
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { setAutotelTracerProvider } from 'autotel/tracer-provider'

// Create isolated provider (don't call provider.register())
const exporter = new OTLPTraceExporter({ url: 'https://your-backend.com/v1/traces' })
const provider = new NodeTracerProvider()
provider.addSpanProcessor(new BatchSpanProcessor(exporter))

// Set as Autotel's provider (isolated from global OTel)
setAutotelTracerProvider(provider)

// Now all trace(), span(), instrument() calls use this provider
```

**Important limitations:**
- Isolates span processing and export only
- OpenTelemetry context (trace IDs, parent spans) is still shared globally
- Spans from isolated provider may inherit context from global spans

**Use cases:**
- Library code with embedded Autotel
- SDKs that need observability without forcing users to configure OTel
- Separate span processing for different subsystems
- Testing with isolated trace collection

#### Semantic Convention Helpers
Pre-configured trace helpers following OpenTelemetry semantic conventions:

```typescript
import { traceLLM, traceDB, traceHTTP, traceMessaging } from 'autotel/semantic-helpers'

// LLM operations (Gen AI semantic conventions)
export const generateText = traceLLM({
  model: 'gpt-4-turbo',
  operation: 'chat',
  provider: 'openai'
})(ctx => async (prompt: string) => {
  const response = await openai.chat.completions.create({ /* ... */ })
  ctx.setAttribute('gen.ai.usage.completion_tokens', response.usage.completion_tokens)
  return response.choices[0].message.content
})

// Database operations (DB semantic conventions)
export const getUser = traceDB({
  system: 'postgresql',
  operation: 'SELECT',
  database: 'app_db',
  collection: 'users'
})(ctx => async (userId: string) => {
  const query = 'SELECT * FROM users WHERE id = $1'
  ctx.setAttribute('db.statement', query)
  return await pool.query(query, [userId])
})

// HTTP client operations (HTTP semantic conventions)
export const fetchUser = traceHTTP({
  method: 'GET',
  url: 'https://api.example.com/users/:id'
})(ctx => async (userId: string) => {
  const response = await fetch(`https://api.example.com/users/${userId}`)
  ctx.setAttribute('http.response.status_code', response.status)
  return response.json()
})

// Messaging operations (Messaging semantic conventions)
export const publishEvent = traceMessaging({
  system: 'kafka',
  operation: 'publish',
  destination: 'user-events'
})(ctx => async (event: Event) => {
  await producer.send({ topic: 'user-events', messages: [event] })
  ctx.setAttribute('messaging.message.id', event.id)
})
```

**Benefits:**
- Automatic semantic attributes following OTel specs
- Type-safe configuration interfaces
- Reduces boilerplate by 60-70%
- Links to official OTel semantic convention docs in JSDoc

**Available helpers:**
- `traceLLM()` - Gen AI operations (chat, completion, embedding)
- `traceDB()` - Database operations (SQL, NoSQL, Redis)
- `traceHTTP()` - HTTP client requests
- `traceMessaging()` - Queue/messaging operations (Kafka, RabbitMQ, SQS)

### Graceful Shutdown
All components implement graceful shutdown:
- `shutdown()` function flushes pending spans/metrics/logs
- Events queue drains before shutdown completes
- Adapters track pending requests and wait for completion
- Use `flush()` for intermediate flushing without shutdown

## Common Development Workflows

### Adding a New Event Subscriber
1. Create new file in `packages/autotel-subscribers/src/`
2. Extend `EventSubscriber` base class
3. Implement `sendToDestination(payload: EventPayload)` method
4. Add export to `packages/autotel-subscribers/src/index.ts`
5. Add entry point to `package.json` exports field
6. Add tests using `SubscriberTestHarness`
7. Create changeset with `pnpm changeset`

### Adding a New Instrumentation Integration
1. Add instrumentation logic to `packages/autotel/src/` (e.g., `redis.ts`)
2. Export from `packages/autotel/src/index.ts`
3. Add entry point to `package.json` exports if tree-shakeable
4. Add tests (unit tests in `.test.ts`, integration tests in `.integration.test.ts`)
5. Update `init.ts` if it needs special SDK configuration
6. Create changeset

### Working with Monorepo Dependencies
- Use `workspace:*` protocol in package.json for internal dependencies
- Changes to dependencies automatically trigger rebuilds (Turborepo cache)
- Install new dependency: `pnpm add <package> --filter <workspace-name>`
- Example: `pnpm add zod --filter autotel`

## Known Constraints

### Edge Runtime Limitations
- No Node.js APIs (fs, net, process) in autotel-edge
- Bundle size must stay under 1MB for Cloudflare Workers free tier
- Some OpenTelemetry features unavailable (auto-instrumentations, resource detectors)
- Context propagation uses minimal AsyncLocalStorage polyfill

### Auto-Instrumentation Requirements

**ESM Setup (Node 18.19+) - Recommended:**

For ESM apps using auto-instrumentation (Pino, Express, HTTP, etc.), you need to:
1. Install `@opentelemetry/auto-instrumentations-node` as a **direct dependency** in your app
2. Import `autotel/register` **first** to register the ESM loader hooks
3. Pass instrumentations directly to `init()` using `getNodeAutoInstrumentations()`

**Option A: With instrumentation.mjs (explicit init, full control):**
```typescript
// instrumentation.mjs
import 'autotel/register';  // MUST be first import!
import { init } from 'autotel';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

init({
  service: 'my-app',
  instrumentations: getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-pino': { enabled: true },
    '@opentelemetry/instrumentation-http': { enabled: true },
  }),
});
```

```bash
tsx --import ./instrumentation.mjs src/index.ts
```

**Option B: Zero-config (reads from env vars):**
```bash
OTEL_SERVICE_NAME=my-app tsx --import autotel/auto src/index.ts
```

Env vars: `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `AUTOTEL_AUTO_INSTRUMENTATIONS` (comma-separated or 'true'), `AUTOTEL_DEBUG`

**Legacy (Node 18.0-18.18):**
```bash
NODE_OPTIONS="--experimental-loader=@opentelemetry/instrumentation/hook.mjs --import ./instrumentation.mjs" tsx src/index.ts
```

**CommonJS:**
No loader hooks required, just use `--require ./instrumentation.js`

**Why ESM requires direct dependency:**
OpenTelemetry's ESM instrumentation uses `import-in-the-middle` to hook into module loading. For this to work, the auto-instrumentations package must be resolvable from your app's node_modules, not just from autotel's dependencies.

### Peer Dependencies
- `@opentelemetry/auto-instrumentations-node` - **optional** peer dependency (install in your app for ESM instrumentation)
- Logger integrations (pino, winston) are optional peer dependencies
- OpenLLMetry integration (@traceloop/node-server-sdk) is optional peer dependency
- gRPC exporters are optional peer dependencies
- Missing optional peer dependencies gracefully degrade with helpful error messages

### Build Outputs
- ESM-first with CJS fallback for index.ts only
- Type definitions (.d.ts) generated from ESM build
- Source maps enabled for debugging
- Use `tsup` for bundling (not tsc directly)
