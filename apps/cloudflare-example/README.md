# Cloudflare Example — autotel/workers

OpenTelemetry instrumentation for Cloudflare Workers using the main `autotel` package (`autotel/workers`). Wraps your handler and every request produces traces with HTTP attributes, span status codes, and exception recording — no manual span management needed.

## Quick Start

```bash
# Start a local OTLP collector (pick one)
docker run -p 4318:4318 otel/opentelemetry-collector:latest

# Run the worker
pnpm dev          # → http://localhost:8787
```

Hit an endpoint, see traces in your collector:

```bash
curl http://localhost:8787/
curl -X POST http://localhost:8787/payment -H 'Content-Type: application/json' -d '{"amount": 50, "userId": "u123"}'
```

## Endpoints

| Path        | Method | Description                                       |
| ----------- | ------ | ------------------------------------------------- |
| `/`         | GET    | Basic request with attribute extractors           |
| `/debug`    | GET    | `runWithLogLevel` — forces debug logging          |
| `/cache`    | GET    | Cache instrumentation via `span()`                |
| `/external` | GET    | Distributed tracing with auto context propagation |
| `/payment`  | POST   | Error handling with proper span status codes      |
| `/users`    | POST   | Nested spans — validation + DB operations         |

Endpoints like `/kv`, `/r2`, `/d1`, `/ai`, `/queue` work when the corresponding binding is uncommented in `wrangler.toml`.

## What Gets Traced

**HTTP requests** — automatic spans with `http.request.method`, `url.full`, `http.response.status_code`.

**Custom functions** — wrap with `trace()` for automatic span naming, attribute extraction from args/results, and error recording:

```typescript
const processPayment = trace(
  {
    name: 'payment.process',
    attributesFromArgs: ([amount, userId]) => ({
      'payment.amount': amount,
      'payment.user_id': userId,
    }),
  },
  (ctx) =>
    async function processPayment(amount: number, userId: string) {
      // ... spans, errors, and attributes are automatic
    },
);
```

**Code blocks** — use `span()` for fine-grained tracing of cache lookups, transformations, etc.

**Bindings** — KV, R2, D1, Service Bindings, AI, Vectorize, Queues, and Analytics Engine are auto-instrumented when present.

**Global fetch** — all `fetch()` calls get trace context propagation injected automatically.

## Edge Logger

Structured JSON logger with Pino-style method calls that auto-correlates with OpenTelemetry traces. Every log entry includes `traceId`, `spanId`, and `correlationId` when inside an active span.

```typescript
import { createEdgeLogger, runWithLogLevel } from 'autotel/workers';

// Create a logger — options: level, pretty, bindings, redact
const log = createEdgeLogger('my-service', {
  level: 'info', // 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent'
  pretty: true, // human-readable for dev, JSON in prod
  bindings: { region: 'local' },
  redact: 'default', // preset: covers passwords, tokens, secrets, auth headers
});

log.info({ path: '/api' }, 'request started');
log.warn({ durationMs: 3200 }, 'slow response');
log.error({ userId: 'u123', err: error }, 'payment failed');
log.debug({ body }, 'payload'); // filtered at info level
```

### Child loggers

Like pino's `child()` — creates a new logger that inherits parent bindings and adds its own. Every call from the child includes both.

```typescript
// In the fetch handler — add request-scoped context
const reqLog = log.child({
  method: request.method,
  path: url.pathname,
  requestId: request.headers.get('cf-ray'),
});

reqLog.info('processing'); // includes method, path, requestId + parent bindings
```

### Log level override

`runWithLogLevel` overrides the level for the duration of a callback — useful for debugging a single request without changing global config:

```typescript
// Force debug logging for this request only
runWithLogLevel('debug', () => {
  log.debug('normally filtered, but visible now');
  handleRequest(request);
});
```

### Bring your own logger

Use `getEdgeTraceContext()` to inject trace IDs into any logger (pino, bunyan, etc.):

```typescript
import { getEdgeTraceContext } from 'autotel/workers';

const ctx = getEdgeTraceContext(); // { traceId, spanId, correlationId } or null
pinoLogger.info({ ...ctx, userId: 'u123' }, 'processing');
```

### Redaction

Built-in redaction replaces sensitive values before output. Uses the same sensitive-key patterns as the main autotel package (passwords, tokens, secrets, auth headers).

```typescript
// Preset — covers the same fields as the main autotel package's 'default' redactor
const log = createEdgeLogger('my-service', { redact: 'default' });

// Other presets: 'strict' (adds bearer/JWT/api-key), 'pci-dss' (card fields)
const strict = createEdgeLogger('my-service', { redact: 'strict' });

// Explicit paths — for custom needs
const custom = createEdgeLogger('my-service', {
  redact: {
    paths: ['password', 'user.email', 'users[*].ssn'],
    censor: '[Filtered]', // optional, default '[Redacted]'
  },
});

// Custom censor function (e.g. mask all but last 4 digits)
const masked = createEdgeLogger('my-service', {
  redact: {
    paths: ['ccn'],
    censor: (val) => '****' + String(val).slice(-4),
  },
});
```

Child loggers inherit redaction — no extra config needed.

## Configuration

Edit `wrangler.toml`:

```toml
[vars]
OTLP_ENDPOINT = "http://localhost:4318/v1/traces"
# ENVIRONMENT = "production"          # enables adaptive sampling
# DISABLE_INSTRUMENTATION = "true"    # turn off all instrumentation
```

Uncomment bindings in `wrangler.toml` to enable those demo endpoints (KV, R2, D1, AI, etc.).

### Sampling

- **Development** (default): 100% sampling
- **Production**: 10% baseline, all errors captured, all slow requests (>1s)

```typescript
sampling: {
  tailSampler:
    env.ENVIRONMENT === 'production'
      ? SamplingPresets.production()
      : SamplingPresets.development(),
},
```

## Project Structure

```
src/
  worker.ts          Main worker — HTTP handler with wrapModule()
  types.ts           Shared Env interface
  actor.ts           Cloudflare Actors example (Durable Objects)
  actor-worker.ts    Actor worker entrypoint
  agent.ts           Agents SDK example (RPC, scheduling, MCP)
  agent-worker.ts    Agent worker entrypoint
  workflow.ts        Cloudflare Workflows example
  workflow-worker.ts Workflow worker entrypoint
```

## Additional Examples

- **Actors** (`src/actor.ts`) — Durable Object lifecycle, storage (SQL), alarm tracing via `@cloudflare/actors`
- **Agents** (`src/agent.ts`) — Agents SDK RPC calls, scheduled tasks, MCP operations via `createOtelObservability()`
- **Workflows** (`src/workflow.ts`) — Workflow step tracing via `instrumentWorkflow()`

## Deploy

```bash
pnpm deploy
```

Set `ENVIRONMENT=production` and configure `OTLP_ENDPOINT` to your observability backend (Honeycomb, Grafana Cloud, etc.).

## Package Choice

- **Recommended:** `autotel` + `autotel/workers` for the best single-package DX.
- **Use `autotel-cloudflare` for feature-targeted Cloudflare instrumentation:** when you want direct control of Cloudflare-specific instrumentation surfaces (bindings, handlers, actors, agents, workflows).
