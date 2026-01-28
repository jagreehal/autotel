# 🔭 autotel

[![npm version](https://img.shields.io/npm/v/autotel.svg?label=autotel)](https://www.npmjs.com/package/autotel)
[![npm subscribers](https://img.shields.io/npm/v/autotel-subscribers.svg?label=subscribers)](https://www.npmjs.com/package/autotel-subscribers)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

**Write once, observe everywhere.** Instrument your Node.js code a single time, keep the DX you love, and stream traces, metrics, logs, and product events to **any** observability stack without vendor lock-in.

- **Drop-in DX** – one `init()` and ergonomic helpers like `trace()`, `span()`, `withTracing()`, decorators, and batch instrumentation.
- **Platform freedom** – OTLP-first design plus subscribers for PostHog, Mixpanel, Amplitude, and anything else via custom exporters/readers.
- **Production hardening** – adaptive sampling (10% baseline, 100% errors/slow paths), rate limiting, circuit breakers, payload validation, and automatic sensitive-field redaction.
- **Auto enrichment** – service metadata, deployment info, and AsyncLocalStorage-powered correlation IDs automatically flow into spans, metrics, logs, and events.

> Raw OpenTelemetry is verbose, and vendor SDKs create lock-in. Autotel gives you the best parts of both: clean ergonomics **and** total ownership of your telemetry.

## Migrating from OpenTelemetry?

**[Migration Guide](../../docs/MIGRATION.md)** - Pattern-by-pattern migration walkthrough with side-by-side comparisons and deployment checklist.

Replace `NODE_OPTIONS` and 30+ lines of SDK boilerplate with `init()`, wrap functions with `trace()` instead of manual `span.start()`/`span.end()`.

---

## Table of Contents

- [🔭 autotel](#-autotel)
  - [Migrating from OpenTelemetry?](#migrating-from-opentelemetry)
  - [Table of Contents](#table-of-contents)
  - [Why Autotel](#why-autotel)
  - [Quick Start](#quick-start)
    - [1. Install](#1-install)
    - [2. Initialize once at startup](#2-initialize-once-at-startup)
    - [3. Instrument code with `trace()`](#3-instrument-code-with-trace)
    - [4. See the value everywhere](#4-see-the-value-everywhere)
  - [Choose Any Destination](#choose-any-destination)
  - [LLM Observability with OpenLLMetry](#llm-observability-with-openllmetry)
    - [Installation](#installation)
    - [Usage](#usage)
  - [Core Building Blocks](#core-building-blocks)
    - [trace()](#trace)
    - [span()](#span)
    - [Trace Context (`ctx`)](#trace-context-ctx)
      - [Baggage (Context Propagation)](#baggage-context-propagation)
    - [Reusable Middleware Helpers](#reusable-middleware-helpers)
    - [Decorators (TypeScript 5+)](#decorators-typescript-5)
    - [Database Instrumentation](#database-instrumentation)
  - [Type-Safe Attributes](#type-safe-attributes)
    - [Pattern A: Key Builders](#pattern-a-key-builders)
    - [Pattern B: Object Builders](#pattern-b-object-builders)
    - [Attachers (Signal Helpers)](#attachers-signal-helpers)
    - [PII Guardrails](#pii-guardrails)
    - [Domain Helpers](#domain-helpers)
    - [Available Attribute Domains](#available-attribute-domains)
    - [Resource Merging](#resource-merging)
  - [Event-Driven Architectures](#event-driven-architectures)
    - [Message Producers (Kafka, SQS, RabbitMQ)](#message-producers-kafka-sqs-rabbitmq)
    - [Message Consumers](#message-consumers)
    - [Consumer Lag Metrics](#consumer-lag-metrics)
    - [Custom Messaging System Adapters](#custom-messaging-system-adapters)
  - [Safe Baggage Propagation](#safe-baggage-propagation)
    - [BusinessBaggage (Pre-built Schema)](#businessbaggage-pre-built-schema)
    - [Custom Baggage Schemas](#custom-baggage-schemas)
  - [Workflow \& Saga Tracing](#workflow--saga-tracing)
    - [Basic Workflows](#basic-workflows)
    - [Saga Pattern with Compensation](#saga-pattern-with-compensation)
  - [Business Metrics \& Product Events](#business-metrics--product-events)
    - [OpenTelemetry Metrics (Metric class + helpers)](#opentelemetry-metrics-metric-class--helpers)
    - [Product Events (PostHog, Mixpanel, Amplitude, …)](#product-events-posthog-mixpanel-amplitude-)
  - [Logging with Trace Context](#logging-with-trace-context)
    - [Using Pino (recommended)](#using-pino-recommended)
    - [Using Winston](#using-winston)
    - [Using Bunyan (or other loggers)](#using-bunyan-or-other-loggers)
    - [What you get automatically](#what-you-get-automatically)
  - [Canonical Log Lines (Wide Events)](#canonical-log-lines-wide-events)
    - [Basic Usage](#basic-usage)
    - [What You Get](#what-you-get)
    - [Query Examples](#query-examples)
    - [Configuration Options](#configuration-options)
  - [Auto Instrumentation \& Advanced Configuration](#auto-instrumentation--advanced-configuration)
    - [⚠️ autoInstrumentations vs. Manual Instrumentations](#️-autoinstrumentations-vs-manual-instrumentations)
      - [Option A: Auto-instrumentations only (all defaults)](#option-a-auto-instrumentations-only-all-defaults)
      - [Option B: Manual instrumentations with custom configs](#option-b-manual-instrumentations-with-custom-configs)
      - [Option C: Mix auto + manual (best of both)](#option-c-mix-auto--manual-best-of-both)
    - [⚠️ Auto-Instrumentation Setup Requirements](#️-auto-instrumentation-setup-requirements)
  - [Operational Safety \& Runtime Controls](#operational-safety--runtime-controls)
  - [Configuration Reference](#configuration-reference)
  - [Building Custom Instrumentation](#building-custom-instrumentation)
    - [Instrumenting Queue Consumers](#instrumenting-queue-consumers)
    - [Instrumenting Scheduled Jobs / Cron](#instrumenting-scheduled-jobs--cron)
    - [Creating Custom Event Subscribers](#creating-custom-event-subscribers)
    - [Low-Level Span Manipulation](#low-level-span-manipulation)
    - [Custom Metrics](#custom-metrics)
  - [Serverless \& Short-lived Processes](#serverless--short-lived-processes)
    - [Manual Flush (Recommended for Serverless)](#manual-flush-recommended-for-serverless)
    - [Auto-Flush Spans (Opt-in)](#auto-flush-spans-opt-in)
    - [Edge Runtimes (Cloudflare Workers, Vercel Edge)](#edge-runtimes-cloudflare-workers-vercel-edge)
  - [API Reference](#api-reference)
  - [FAQ \& Next Steps](#faq--next-steps)
  - [Troubleshooting \& Debugging](#troubleshooting--debugging)
    - [Quick Debug Mode (Recommended)](#quick-debug-mode-recommended)
    - [Manual Configuration (Advanced)](#manual-configuration-advanced)
      - [ConsoleSpanExporter (Visual Debugging)](#consolespanexporter-visual-debugging)
    - [InMemorySpanExporter (Testing \& Assertions)](#inmemoryspanexporter-testing--assertions)
    - [Using Both (Advanced)](#using-both-advanced)
  - [Creating Custom Instrumentation](#creating-custom-instrumentation)
    - [Quick Start Template](#quick-start-template)
    - [Step-by-Step Tutorial: Instrumenting Axios](#step-by-step-tutorial-instrumenting-axios)
    - [Best Practices](#best-practices)
      - [1. Idempotent Instrumentation](#1-idempotent-instrumentation)
      - [2. Error Handling](#2-error-handling)
      - [3. Security - Don't Capture Sensitive Data](#3-security---dont-capture-sensitive-data)
      - [4. Follow OpenTelemetry Semantic Conventions](#4-follow-opentelemetry-semantic-conventions)
      - [5. Choose the Right SpanKind](#5-choose-the-right-spankind)
      - [6. TypeScript Type Safety](#6-typescript-type-safety)
    - [Available Utilities](#available-utilities)
      - [From `autotel/trace-helpers`](#from-autoteltrace-helpers)
      - [From `@opentelemetry/api`](#from-opentelemetryapi)
      - [Semantic Conventions (Optional)](#semantic-conventions-optional)
    - [Real-World Examples](#real-world-examples)
    - [When to Create Custom Instrumentation](#when-to-create-custom-instrumentation)
    - [Using Official Instrumentation](#using-official-instrumentation)

## Why Autotel

| Challenge                                                                                      | With autotel                                                                                                                     |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Writing raw OpenTelemetry spans/metrics takes dozens of lines and manual lifecycle management. | Wrap any function in `trace()` or `span()` and get automatic span lifecycle, error capture, attributes, and adaptive sampling.   |
| Vendor SDKs simplify setup but trap your data in a single platform.                            | Autotel is OTLP-native and works with Grafana Cloud, Datadog, New Relic, Tempo, Honeycomb, Elasticsearch, or your own collector. |
| Teams need both observability **and** product events.                                          | Ship technical telemetry and funnel/behavior events through the same API with contextual enrichment.                             |
| Production readiness requires redaction, rate limiting, and circuit breakers.                  | Those guardrails are on by default so you can safely enable telemetry everywhere.                                                |

## Quick Start

> Want to follow along in code? This repo ships with `apps/example-basic` (mirrors the steps below) and `apps/example-http` for an Express server, you can run either with `pnpm start` after `pnpm install && pnpm build` at the root.

### 1. Install

```bash
npm install autotel
# or
pnpm add autotel
```

### 2. Initialize once at startup

```typescript
import { init } from 'autotel';

init({
  service: 'checkout-api',
  environment: process.env.NODE_ENV,
});
```

Defaults:

- OTLP endpoint: `process.env.OTLP_ENDPOINT || http://localhost:4318`
- Metrics: on in every environment
- Sampler: adaptive (10% baseline, 100% for errors/slow spans)
- Version: auto-detected from `package.json`
- Events auto-flush when the root span finishes

### 3. Instrument code with `trace()`

```typescript
import { trace } from 'autotel';

export const createUser = trace(async function createUser(
  data: CreateUserData,
) {
  const user = await db.users.insert(data);
  return user;
});
```

- Named function expressions automatically become span names (`code.function`).
- Errors are recorded, spans are ended, and status is set automatically.

### 4. See the value everywhere

```typescript
import { init, track } from 'autotel';

init({
  service: 'checkout-api',
  endpoint: 'https://otlp-gateway-prod.grafana.net/otlp',
  subscribers: [new PostHogSubscriber({ apiKey: process.env.POSTHOG_KEY! })],
});

export const processOrder = trace(async function processOrder(order) {
  track('order.completed', { amount: order.total });
  return charge(order);
});
```

Every span, metric, log line, and event includes `traceId`, `spanId`, `operation.name`, `service.version`, and `deployment.environment` automatically.

## Choose Any Destination

```typescript
import { init } from 'autotel';

init({
  service: 'my-app',
  // Grafana / Tempo / OTLP collector
  endpoint: 'https://otlp-gateway-prod.grafana.net/otlp',
});

init({
  service: 'my-app',
  // Datadog (traces + metrics + logs via OTLP)
  endpoint: 'https://otlp.datadoghq.com',
  headers: 'dd-api-key=...',
});

init({
  service: 'my-app',
  // Honeycomb (gRPC protocol)
  protocol: 'grpc',
  endpoint: 'api.honeycomb.io:443',
  headers: {
    'x-honeycomb-team': process.env.HONEYCOMB_API_KEY!,
  },
});

init({
  service: 'my-app',
  // Custom pipeline with your own exporters/readers
  spanProcessor: new BatchSpanProcessor(
    new JaegerExporter({ endpoint: 'http://otel:14268/api/traces' }),
  ),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: 'https://metrics.example.com/v1/metrics',
    }),
  }),
  logRecordProcessors: [
    new BatchLogRecordProcessor(
      new OTLPLogExporter({ url: 'https://logs.example.com/v1/logs' }),
    ),
  ],
  instrumentations: [new HttpInstrumentation()],
});

init({
  service: 'my-app',
  // Product events subscribers (ship alongside OTLP)
  subscribers: [
    new PostHogSubscriber({ apiKey: process.env.POSTHOG_KEY! }),
    new MixpanelSubscriber({ projectToken: process.env.MIXPANEL_TOKEN! }),
  ],
});

init({
  service: 'my-app',
  // OpenLLMetry integration for LLM observability
  openllmetry: {
    enabled: true,
    options: {
      disableBatch: process.env.NODE_ENV !== 'production',
      apiKey: process.env.TRACELOOP_API_KEY,
    },
  },
});
```

Autotel never owns your data, it's a thin layer over OpenTelemetry with optional adapters.

## LLM Observability with OpenLLMetry

Autotel integrates seamlessly with [OpenLLMetry](https://github.com/traceloop/openllmetry) to provide comprehensive observability for LLM applications. OpenLLMetry automatically instruments LLM providers (OpenAI, Anthropic, etc.), vector databases, and frameworks (LangChain, LlamaIndex, etc.).

### Installation

Install the OpenLLMetry SDK as an optional peer dependency:

```bash
pnpm add @traceloop/node-server-sdk
# or
npm install @traceloop/node-server-sdk
```

### Usage

Enable OpenLLMetry in your autotel configuration:

```typescript
import { init } from 'autotel';

init({
  service: 'my-llm-app',
  endpoint: process.env.OTLP_ENDPOINT,
  openllmetry: {
    enabled: true,
    options: {
      // Disable batching in development for immediate traces
      disableBatch: process.env.NODE_ENV !== 'production',
      // Optional: Traceloop API key if using Traceloop backend
      apiKey: process.env.TRACELOOP_API_KEY,
    },
  },
});
```

OpenLLMetry will automatically:

- Instrument LLM calls (OpenAI, Anthropic, Cohere, etc.)
- Track vector database operations (Pinecone, Chroma, Qdrant, etc.)
- Monitor LLM frameworks (LangChain, LlamaIndex, LangGraph, etc.)
- Reuse autotel's OpenTelemetry tracer provider for unified traces

All LLM spans will appear alongside your application traces in your observability backend.

**AI Workflow Patterns:** See [AI/LLM Workflow Documentation](../../docs/AI_WORKFLOWS.md) for comprehensive patterns including:

- Multi-agent workflows (orchestration and handoffs)
- RAG pipelines (embeddings, search, generation)
- Streaming responses
- Evaluation loops
- Working examples in `apps/example-ai-agent`

## Core Building Blocks

### trace()

Wrap any sync/async function to create spans automatically.

```typescript
import { trace } from 'autotel';

export const updateUser = trace(async function updateUser(
  id: string,
  data: UserInput,
) {
  return db.users.update(id, data);
});

// Explicit name (useful for anonymous/arrow functions)
export const deleteUser = trace('user.delete', async (id: string) => {
  return db.users.delete(id);
});

// Factory form exposes the `ctx` helper (see below)
export const createOrder = trace((ctx) => async (order: Order) => {
  ctx.setAttribute('order.id', order.id);
  return submit(order);
});

// Immediate execution - wraps and executes instantly (for middleware/wrappers)
function timed<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  return trace(operation, async (ctx) => {
    ctx.setAttribute('operation', operation);
    return await fn();
  });
}
// Executes immediately, returns Promise<T> directly
```

**Two patterns supported:**

1. **Factory pattern** `trace(ctx => (...args) => result)` – Returns a wrapped function for reuse
2. **Immediate execution** `trace(ctx => result)` – Executes once immediately, returns the result directly

- Automatic span lifecycle (`start`, `end`, status, and error recording).
- Function names feed `operation.name`, `code.function`, and events enrichment.
- Works with promises, async/await, or sync functions.

### span()

Create nested spans for individual code blocks without wrapping entire functions.

```typescript
import { span, trace } from 'autotel';

export const rollDice = trace(async function rollDice(rolls: number) {
  const results: number[] = [];

  for (let i = 0; i < rolls; i++) {
    await span(
      { name: 'roll.once', attributes: { roll: i + 1 } },
      async (span) => {
        span.setAttribute('range', '1-6');
        span.addEvent('dice.rolled', { value: rollOnce() });
        results.push(rollOnce());
      },
    );
  }

  return results;
});
```

Nested spans automatically inherit context and correlation IDs.

### Trace Context (`ctx`)

Every `trace((ctx) => ...)` factory receives a type-safe helper backed by `AsyncLocalStorage`.

```typescript
export const createUser = trace((ctx) => async (input: CreateUserData) => {
  logger.info({ traceId: ctx.traceId }, 'Handling request');
  ctx.setAttributes({ 'user.id': input.id, 'user.plan': input.plan });

  try {
    const user = await db.users.create(input);
    ctx.setStatus({ code: SpanStatusCode.OK });
    return user;
  } catch (error) {
    ctx.recordException(error as Error);
    ctx.setStatus({
      code: SpanStatusCode.ERROR,
      message: 'Failed to create user',
    });
    throw error;
  }
});
```

Available helpers: `traceId`, `spanId`, `correlationId`, `setAttribute`, `setAttributes`, `setStatus`, `recordException`, `getBaggage`, `setBaggage`, `deleteBaggage`, `getAllBaggage`.

#### Baggage (Context Propagation)

Baggage allows you to propagate custom key-value pairs across distributed traces. Baggage is automatically included in HTTP headers when using `injectTraceContext()` from `autotel/http`.

```typescript
import { trace, withBaggage } from 'autotel';
import { injectTraceContext } from 'autotel/http';

// Set baggage for downstream services
export const createOrder = trace((ctx) => async (order: Order) => {
  return await withBaggage({
    baggage: {
      'tenant.id': order.tenantId,
      'user.id': order.userId,
    },
    fn: async () => {
      // Baggage is available to all child spans and HTTP calls
      const tenantId = ctx.getBaggage('tenant.id');
      ctx.setAttribute('tenant.id', tenantId || 'unknown');

      // HTTP headers automatically include baggage
      const headers = injectTraceContext();
      await fetch('/api/charge', { headers, body: JSON.stringify(order) });
    },
  });
});
```

**Typed Baggage (Optional):**

For type-safe baggage operations, use `defineBaggageSchema()`:

```typescript
import { trace, defineBaggageSchema } from 'autotel';

type TenantBaggage = { tenantId: string; region?: string };
const tenantBaggage = defineBaggageSchema<TenantBaggage>('tenant');

export const handler = trace<TenantBaggage>((ctx) => async () => {
  // Type-safe get
  const tenant = tenantBaggage.get(ctx);
  if (tenant?.tenantId) {
    console.log('Tenant:', tenant.tenantId);
  }

  // Type-safe set with proper scoping
  return await tenantBaggage.with(ctx, { tenantId: 't1' }, async () => {
    // Baggage is available here and in child spans
  });
});
```

**Automatic Baggage → Span Attributes:**

Enable `baggage: true` in `init()` to automatically copy all baggage entries to span attributes, making them visible in trace UIs without manual `ctx.setAttribute()` calls:

```typescript
import { init, trace, withBaggage } from 'autotel';

init({
  service: 'my-app',
  baggage: true, // Auto-copy baggage to span attributes
});

export const processOrder = trace((ctx) => async (order: Order) => {
  return await withBaggage({
    baggage: {
      'tenant.id': order.tenantId,
      'user.id': order.userId,
    },
    fn: async () => {
      // Span automatically has baggage.tenant.id and baggage.user.id attributes!
      // No need for: ctx.setAttribute('tenant.id', ctx.getBaggage('tenant.id'))
      await chargeCustomer(order);
    },
  });
});
```

**Custom prefix:**

```typescript
init({
  service: 'my-app',
  baggage: 'ctx', // Creates ctx.tenant.id, ctx.user.id
  // Or use '' for no prefix: tenant.id, user.id
});
```

**Extracting Baggage from Incoming Requests:**

```typescript
import { extractTraceContext, trace, context } from 'autotel';

// In Express middleware
app.use((req, res, next) => {
  const extractedContext = extractTraceContext(req.headers);
  context.with(extractedContext, () => {
    next();
  });
});
```

**Key Points:**

- Typed baggage is completely optional - existing untyped baggage code continues to work without changes
- `baggage: true` in `init()` eliminates manual attribute setting for baggage
- Baggage values are strings (convert numbers/objects before setting)
- Never put PII in baggage - it propagates in HTTP headers across services!

### Reusable Middleware Helpers

- `withTracing(options)` – create a preconfigured wrapper (service name, default attributes, skip rules).
- `instrument(object, options)` – batch-wrap entire modules while skipping helpers or private functions.

```typescript
import { withTracing, instrument } from 'autotel';

const traceFn = withTracing({ serviceName: 'user' });

export const create = traceFn((ctx) => async (payload) => {
  /* ... */
});
export const update = traceFn((ctx) => async (id, payload) => {
  /* ... */
});

export const repository = instrument(
  {
    createUser: async () => {
      /* ... */
    },
    updateUser: async () => {
      /* ... */
    },
    _internal: async () => {
      /* skipped */
    },
  },
  { serviceName: 'repository', skip: ['_internal'] },
);
```

### Decorators (TypeScript 5+)

Prefer classes or NestJS-style services? Use the `@Trace` decorator.

```typescript
import { Trace } from 'autotel/decorators';

class OrderService {
  @Trace('order.create', { withMetrics: true })
  async createOrder(data: OrderInput) {
    return db.orders.create(data);
  }

  // No arguments → method name becomes the span name
  @Trace()
  async processPayment(orderId: string) {
    return charge(orderId);
  }

  @Trace()
  async refund(orderId: string) {
    const ctx = (this as any).ctx;
    ctx.setAttribute('order.id', orderId);
    return refund(orderId);
  }
}
```

Decorators are optional, everything also works in plain functions.

### Database Instrumentation

Turn on query tracing in one line.

```typescript
import { instrumentDatabase } from 'autotel/db';

const db = drizzle(pool);

instrumentDatabase(db, {
  dbSystem: 'postgresql',
  database: 'myapp',
});

await db.select().from(users); // queries emit spans automatically
```

## Type-Safe Attributes

Autotel provides type-safe attribute builders following OpenTelemetry semantic conventions. These helpers give you autocomplete, compile-time validation, and automatic PII redaction.

### Pattern A: Key Builders

Build individual attributes with full autocomplete:

```typescript
import { attrs, mergeAttrs } from 'autotel/attributes';

// Single attribute
ctx.setAttributes(attrs.user.id('user-123'));
// → { 'user.id': 'user-123' }

ctx.setAttributes(attrs.http.request.method('GET'));
// → { 'http.request.method': 'GET' }

ctx.setAttributes(attrs.db.client.system('postgresql'));
// → { 'db.system.name': 'postgresql' }

// Combine multiple attributes
ctx.setAttributes(
  mergeAttrs(
    attrs.user.id('user-123'),
    attrs.session.id('sess-456'),
    attrs.http.response.statusCode(200),
  ),
);
```

### Pattern B: Object Builders

Pass an object to set multiple related attributes at once:

```typescript
import { attrs } from 'autotel/attributes';

// User attributes
ctx.setAttributes(
  attrs.user.data({
    id: 'user-123',
    email: 'user@example.com',
    roles: ['admin', 'editor'],
  }),
);
// → { 'user.id': 'user-123', 'user.email': 'user@example.com', 'user.roles': ['admin', 'editor'] }

// HTTP server attributes
ctx.setAttributes(
  attrs.http.server({
    method: 'POST',
    route: '/api/users/:id',
    statusCode: 201,
  }),
);
// → { 'http.request.method': 'POST', 'http.route': '/api/users/:id', 'http.response.status_code': 201 }

// Database attributes
ctx.setAttributes(
  attrs.db.client.data({
    system: 'postgresql',
    name: 'myapp_db', // Maps to db.namespace
    operation: 'SELECT',
    collectionName: 'users',
  }),
);
```

### Attachers (Signal Helpers)

Attachers know WHERE to attach attributes - they handle spans, resources, and apply guardrails automatically:

```typescript
import { setUser, httpServer, identify, dbClient } from 'autotel/attributes';

// Set user attributes with automatic PII redaction
export const handleRequest = trace((ctx) => async (req) => {
  setUser(ctx, {
    id: req.userId,
    email: req.userEmail, // Automatically redacted by default
  });

  // HTTP attributes + automatic span name update
  httpServer(ctx, {
    method: req.method,
    route: req.route,
    statusCode: 200,
  });
  // Span name becomes: "HTTP GET /api/users"
});

// Bundle user, session, and device attributes together
export const identifyUser = trace((ctx) => async (data) => {
  identify(ctx, {
    user: { id: data.userId, name: data.userName },
    session: { id: data.sessionId },
    device: { id: data.deviceId, manufacturer: 'Apple' },
  });
});

// Database client attributes
export const queryUsers = trace((ctx) => async () => {
  dbClient(ctx, {
    system: 'postgresql',
    operation: 'SELECT',
    collectionName: 'users',
  });
  return await db.query('SELECT * FROM users');
});
```

### PII Guardrails

`safeSetAttributes()` applies automatic PII detection and configurable guardrails:

```typescript
import { safeSetAttributes, attrs } from 'autotel/attributes';

export const processUser = trace((ctx) => async (user) => {
  // Default: PII is redacted automatically
  safeSetAttributes(ctx, attrs.user.data({ email: 'user@example.com' }));
  // → { 'user.email': '[REDACTED]' }

  // Allow PII (use with caution)
  safeSetAttributes(ctx, attrs.user.data({ email: 'user@example.com' }), {
    guardrails: { pii: 'allow' },
  });
  // → { 'user.email': 'user@example.com' }

  // Hash PII for correlation without exposing raw values
  safeSetAttributes(ctx, attrs.user.data({ email: 'user@example.com' }), {
    guardrails: { pii: 'hash' },
  });
  // → { 'user.email': 'hash_a1b2c3d4...' }

  // Truncate long values
  safeSetAttributes(ctx, attrs.user.data({ id: 'a'.repeat(500) }), {
    guardrails: { maxLength: 255 },
  });
  // → { 'user.id': 'aaaa...aaa...' } (truncated with ellipsis)

  // Warn on deprecated attributes
  safeSetAttributes(
    ctx,
    { 'http.method': 'GET' }, // Deprecated!
    { guardrails: { warnDeprecated: true } },
  );
  // Console: [autotel/attributes] Attribute "http.method" is deprecated. Use "http.request.method" instead.
});
```

**Guardrail Options:**

| Option           | Values                                     | Default    | Description                                |
| ---------------- | ------------------------------------------ | ---------- | ------------------------------------------ |
| `pii`            | `'allow'`, `'redact'`, `'hash'`, `'block'` | `'redact'` | How to handle PII in attribute values      |
| `maxLength`      | number                                     | `255`      | Maximum string length before truncation    |
| `validateEnum`   | boolean                                    | `true`     | Normalize enum values (e.g., HTTP methods) |
| `warnDeprecated` | boolean                                    | `true`     | Log warnings for deprecated attributes     |

### Domain Helpers

Domain helpers bundle multiple attribute groups for common scenarios:

```typescript
import { transaction } from 'autotel/attributes';

// Bundle HTTP request with user context
export const handleRequest = trace((ctx) => async (req) => {
  transaction(ctx, {
    user: { id: req.userId },
    session: { id: req.sessionId },
    method: req.method,
    route: req.route,
    statusCode: 200,
    clientIp: req.ip,
  });
  // Sets: user.id, session.id, http.request.method, http.route,
  //       http.response.status_code, network.peer.address
  // Also updates span name to "HTTP GET /api/users"
});
```

### Available Attribute Domains

| Domain      | Key Builders                                         | Object Builder                               |
| ----------- | ---------------------------------------------------- | -------------------------------------------- |
| `user`      | `id`, `email`, `name`, `fullName`, `hash`, `roles`   | `attrs.user.data()`                          |
| `session`   | `id`, `previousId`                                   | `attrs.session.data()`                       |
| `device`    | `id`, `manufacturer`, `modelIdentifier`, `modelName` | `attrs.device.data()`                        |
| `http`      | `request.*`, `response.*`, `route`                   | `attrs.http.server()`, `attrs.http.client()` |
| `db`        | `client.system`, `client.operation`, etc.            | `attrs.db.client.data()`                     |
| `service`   | `name`, `instance`, `version`                        | `attrs.service.data()`                       |
| `network`   | `peerAddress`, `peerPort`, `transport`, etc.         | `attrs.network.data()`                       |
| `error`     | `type`, `message`, `stackTrace`, `code`              | `attrs.error.data()`                         |
| `exception` | `escaped`, `message`, `stackTrace`, `type`           | `attrs.exception.data()`                     |
| `cloud`     | `provider`, `accountId`, `region`, etc.              | `attrs.cloud.data()`                         |
| `messaging` | `system`, `destination`, `operation`, etc.           | `attrs.messaging.data()`                     |
| `genAI`     | `system`, `requestModel`, `responseModel`, etc.      | -                                            |
| `rpc`       | `system`, `service`, `method`                        | -                                            |
| `graphql`   | `document`, `operationName`, `operationType`         | -                                            |

### Resource Merging

For enriching OpenTelemetry Resources with service attributes (Resource.attributes is readonly), use `mergeServiceResource`:

```typescript
import { mergeServiceResource } from 'autotel/attributes';
import { Resource } from '@opentelemetry/resources';

// Create enriched resource for custom SDK configurations
const baseResource = Resource.default();
const enrichedResource = mergeServiceResource(baseResource, {
  name: 'my-service',
  version: '1.0.0',
  instance: 'instance-1',
});

// Use with custom TracerProvider
const provider = new NodeTracerProvider({ resource: enrichedResource });
```

## Event-Driven Architectures

Autotel provides first-class support for tracing message-based systems like Kafka, SQS, and RabbitMQ. The `traceProducer` and `traceConsumer` helpers automatically set semantic attributes, handle context propagation, and create proper span links.

### Message Producers (Kafka, SQS, RabbitMQ)

Use `traceProducer` to wrap message publishing functions with automatic tracing:

```typescript
import { traceProducer, type ProducerContext } from 'autotel';

// Kafka producer
export const publishUserEvent = traceProducer({
  system: 'kafka',
  destination: 'user-events',
  messageIdFrom: (args) => args[0].eventId, // Extract message ID from args
})((ctx) => async (event: UserEvent) => {
  // Get W3C trace headers to inject into message
  const headers = ctx.getTraceHeaders();

  await producer.send({
    topic: 'user-events',
    messages: [
      {
        key: event.userId,
        value: JSON.stringify(event),
        headers, // Trace context propagates to consumers
      },
    ],
  });
});

// SQS producer with custom attributes
export const publishOrder = traceProducer({
  system: 'sqs',
  destination: 'orders-queue',
  attributes: { 'custom.priority': 'high' },
})((ctx) => async (order: Order) => {
  ctx.setAttribute('order.total', order.total);

  await sqs.sendMessage({
    QueueUrl: QUEUE_URL,
    MessageBody: JSON.stringify(order),
    MessageAttributes: {
      traceparent: {
        DataType: 'String',
        StringValue: ctx.getTraceHeaders().traceparent,
      },
    },
  });
});
```

**Automatic Span Attributes (OTel Semantic Conventions):**

- `messaging.system` - The messaging system (kafka, sqs, rabbitmq, etc.)
- `messaging.operation` - Always "publish" for producers
- `messaging.destination.name` - Topic/queue name
- `messaging.message.id` - Extracted message ID (if configured)
- `messaging.kafka.destination.partition` - Partition number (Kafka-specific)

### Message Consumers

Use `traceConsumer` to wrap message handlers with automatic link extraction and DLQ support:

```typescript
import { traceConsumer, extractLinksFromBatch } from 'autotel';

// Single message consumer
export const processUserEvent = traceConsumer({
  system: 'kafka',
  destination: 'user-events',
  consumerGroup: 'event-processor',
  headersFrom: (msg) => msg.headers, // Extract trace headers
})((ctx) => async (message: KafkaMessage) => {
  // Links to producer span are automatically created
  const event = JSON.parse(message.value);
  await processEvent(event);
});

// Batch consumer with automatic link extraction
export const processBatch = traceConsumer({
  system: 'kafka',
  destination: 'user-events',
  consumerGroup: 'batch-processor',
  batchMode: true, // Extract links from all messages
  headersFrom: (msg) => msg.headers,
})((ctx) => async (messages: KafkaMessage[]) => {
  // ctx.links contains SpanContext from each message's traceparent
  for (const msg of messages) {
    await processMessage(msg);
  }
});

// Consumer with DLQ handling
export const processWithDLQ = traceConsumer({
  system: 'sqs',
  destination: 'orders-queue',
  headersFrom: (msg) => msg.MessageAttributes,
})((ctx) => async (message: SQSMessage) => {
  try {
    await processOrder(JSON.parse(message.Body));
  } catch (error) {
    if (message.ApproximateReceiveCount > 3) {
      // Record DLQ routing
      ctx.recordDLQ('orders-dlq', error.message);
      throw error; // Let SQS move to DLQ
    }
    throw error; // Retry
  }
});
```

**Consumer-Specific Attributes:**

- `messaging.consumer.group` - Consumer group name
- `messaging.batch.message_count` - Batch size (if batch mode)
- `messaging.operation` - "receive" or "process"

### Consumer Lag Metrics

Track consumer lag for performance monitoring:

```typescript
import { traceConsumer } from 'autotel';

export const processWithLag = traceConsumer({
  system: 'kafka',
  destination: 'events',
  consumerGroup: 'processor',
  lagMetrics: {
    getCurrentOffset: (msg) => Number(msg.offset),
    getEndOffset: async () => {
      const offsets = await admin.fetchTopicOffsets('events');
      return Number(offsets[0].high);
    },
    partition: 0,
  },
})((ctx) => async (message) => {
  // Lag attributes automatically added:
  // - messaging.kafka.consumer_lag
  // - messaging.kafka.message_offset
  await processMessage(message);
});
```

### Custom Messaging System Adapters

For messaging systems not directly supported (NATS, Temporal, Cloudflare Queues, etc.), use pre-built adapters or create your own:

```typescript
import { traceConsumer, traceProducer } from 'autotel/messaging';
import {
  natsAdapter,
  temporalAdapter,
  cloudflareQueuesAdapter,
  datadogContextExtractor,
  b3ContextExtractor,
} from 'autotel/messaging/adapters';

// NATS JetStream consumer with automatic attribute extraction
const processNatsMessage = traceConsumer({
  system: 'nats',
  destination: 'orders.created',
  consumerGroup: 'order-processor',
  ...natsAdapter.consumer, // Adds nats.subject, nats.stream, nats.consumer
})((ctx) => async (msg) => {
  await handleOrder(msg.data);
  msg.ack();
});

// Temporal activity with workflow context
const processActivity = traceConsumer({
  system: 'temporal',
  destination: 'order-activities',
  ...temporalAdapter.consumer, // Adds temporal.workflow_id, temporal.run_id, temporal.attempt
})((ctx) => async (info, input) => {
  return processOrder(input);
});

// Consume messages with Datadog trace context (non-W3C format)
const processFromDatadog = traceConsumer({
  system: 'kafka',
  destination: 'events',
  customContextExtractor: datadogContextExtractor, // Converts Datadog decimal IDs to OTel hex
})((ctx) => async (msg) => {
  // Links to parent Datadog span automatically
});
```

**Available Adapters:**

| Adapter                   | Captures                                              |
| ------------------------- | ----------------------------------------------------- |
| `natsAdapter`             | subject, stream, consumer, pending, redelivery_count  |
| `temporalAdapter`         | workflow_id, run_id, activity_id, task_queue, attempt |
| `cloudflareQueuesAdapter` | message_id, timestamp, attempts                       |
| `datadogContextExtractor` | Converts Datadog decimal trace IDs to OTel hex        |
| `b3ContextExtractor`      | Parses B3/Zipkin single or multi-header format        |
| `xrayContextExtractor`    | Parses AWS X-Ray trace header                         |

**Building Custom Adapters:**

See [Bring Your Own System Guide](./docs/messaging-byos-guide.md) for step-by-step instructions on creating adapters for any messaging system.

## Safe Baggage Propagation

Baggage allows key-value pairs to propagate across service boundaries. Autotel provides safe baggage schemas with built-in guardrails for PII detection, size limits, and high-cardinality value hashing.

### BusinessBaggage (Pre-built Schema)

Use the pre-built `BusinessBaggage` schema for common business context:

```typescript
import { BusinessBaggage, trace } from 'autotel';

export const processOrder = trace((ctx) => async (order: Order) => {
  // Set business context (propagates to downstream services)
  BusinessBaggage.set(ctx, {
    tenantId: order.tenantId,
    userId: order.userId, // Auto-hashed for privacy
    priority: 'high', // Validated against enum
    correlationId: order.id,
  });

  // Make downstream call - baggage propagates automatically
  await fetch('/api/charge', {
    headers: ctx.getTraceHeaders(), // Includes baggage header
  });
});

// In downstream service
export const chargeOrder = trace((ctx) => async () => {
  // Read business context
  const { tenantId, userId, priority } = BusinessBaggage.get(ctx);

  // Use for routing, logging, access control, etc.
  logger.info({ tenantId, priority }, 'Processing charge');
});
```

**Pre-defined Fields:**

- `tenantId` - String, max 64 chars
- `userId` - String, auto-hashed for privacy
- `correlationId` - String, for request correlation
- `workflowId` - String, for saga/workflow tracking
- `priority` - Enum: 'low', 'normal', 'high', 'critical'
- `region` - String, deployment region
- `channel` - String (web, mobile, api, etc.)

### Custom Baggage Schemas

Create type-safe baggage schemas with validation and guardrails:

```typescript
import { createSafeBaggageSchema } from 'autotel';

// Define custom schema
const OrderBaggage = createSafeBaggageSchema(
  {
    orderId: { type: 'string', maxLength: 36 },
    customerId: { type: 'string', hash: true }, // Auto-hash for privacy
    tier: { type: 'enum', values: ['free', 'pro', 'enterprise'] as const },
    amount: { type: 'number' },
    isVip: { type: 'boolean' },
  },
  {
    prefix: 'order', // Baggage keys: order.orderId, order.tier, etc.
    maxKeyLength: 64, // Validate key length
    maxValueLength: 256, // Validate value length
    redactPII: true, // Auto-detect and redact PII patterns
    hashHighCardinality: true, // Hash values that look high-cardinality
  },
);

// Use in traced functions
export const processOrder = trace((ctx) => async (order: Order) => {
  // Type-safe set (TypeScript validates fields)
  OrderBaggage.set(ctx, {
    orderId: order.id,
    customerId: order.customerId, // Will be hashed
    tier: order.tier, // Must be 'free' | 'pro' | 'enterprise'
    amount: order.total,
    isVip: order.customer.isVip,
  });

  // Type-safe get
  const { orderId, tier, isVip } = OrderBaggage.get(ctx);

  // Check if specific field is set
  if (OrderBaggage.has(ctx, 'customerId')) {
    // ...
  }

  // Delete specific field
  OrderBaggage.delete(ctx, 'amount');

  // Clear all fields
  OrderBaggage.clear(ctx);
});
```

**Guardrails:**

- **Size Limits** - Prevents baggage from growing unbounded
- **PII Detection** - Auto-redacts email, phone, SSN patterns
- **High-Cardinality Hashing** - Hashes UUIDs, timestamps to reduce cardinality
- **Enum Validation** - Rejects invalid enum values
- **Type Coercion** - Numbers/booleans serialized correctly

## Workflow & Saga Tracing

Track distributed workflows and sagas with compensation support. Each step creates a linked span, and failed steps can trigger automatic compensation.

### Basic Workflows

Use `traceWorkflow` and `traceStep` for multi-step processes:

```typescript
import { traceWorkflow, traceStep } from 'autotel';

// Define workflow with unique ID
export const processOrder = traceWorkflow({
  name: 'OrderFulfillment',
  workflowId: (order) => order.id, // Generate from first arg
})((ctx) => async (order: Order) => {
  // Step 1: Validate order
  await traceStep({ name: 'ValidateOrder' })((ctx) => async () => {
    await validateOrder(order);
  })();

  // Step 2: Reserve inventory (links to previous step)
  await traceStep({
    name: 'ReserveInventory',
    linkToPrevious: true,
  })((ctx) => async () => {
    await inventoryService.reserve(order.items);
  })();

  // Step 3: Process payment
  await traceStep({
    name: 'ProcessPayment',
    linkToPrevious: true,
  })((ctx) => async () => {
    await paymentService.charge(order);
  })();

  return { success: true };
});
```

**Workflow Attributes:**

- `workflow.name` - Workflow type name
- `workflow.id` - Unique instance ID
- `workflow.version` - Optional version
- `workflow.step.name` - Current step name
- `workflow.step.index` - Step sequence number
- `workflow.step.status` - completed, failed, compensated

### Saga Pattern with Compensation

Define compensating actions for rollback on failure:

```typescript
import { traceWorkflow, traceStep } from 'autotel';

export const orderSaga = traceWorkflow({
  name: 'OrderSaga',
  workflowId: (order) => order.id,
})((ctx) => async (order: Order) => {
  // Step 1: Reserve inventory (with compensation)
  await traceStep({
    name: 'ReserveInventory',
    compensate: async (stepCtx, error) => {
      // Called if later step fails
      await inventoryService.release(order.items);
      stepCtx.setAttribute('compensation.reason', error.message);
    },
  })((ctx) => async () => {
    await inventoryService.reserve(order.items);
  })();

  // Step 2: Charge payment (with compensation)
  await traceStep({
    name: 'ChargePayment',
    linkToPrevious: true,
    compensate: async (stepCtx, error) => {
      await paymentService.refund(order.id);
    },
  })((ctx) => async () => {
    await paymentService.charge(order);
  })();

  // Step 3: Ship order (no compensation - point of no return)
  await traceStep({
    name: 'ShipOrder',
    linkToPrevious: true,
  })((ctx) => async () => {
    await shippingService.ship(order);
  })();
});

// If ShipOrder fails, compensations run in reverse:
// 1. ChargePayment.compensate (refund)
// 2. ReserveInventory.compensate (release)
```

**WorkflowContext Methods:**

- `ctx.getWorkflowId()` - Get current workflow instance ID
- `ctx.getWorkflowName()` - Get workflow type name
- `ctx.getStepIndex()` - Current step number
- `ctx.getPreviousStepContext()` - SpanContext for linking

**Compensation Attributes:**

- `workflow.step.compensated` - Boolean, true if compensation ran
- `workflow.compensation.executed` - Number of compensations executed
- `compensation.reason` - Why compensation was triggered

## Business Metrics & Product Events

Autotel treats metrics and events as first-class citizens so engineers and product teams share the same context.

### OpenTelemetry Metrics (Metric class + helpers)

```typescript
import { Metric, createHistogram } from 'autotel';

const metrics = new Metric('checkout');
const revenue = createHistogram('checkout.revenue');

export const processOrder = trace((ctx) => async (order) => {
  metrics.trackEvent('order.completed', {
    orderId: order.id,
    amount: order.total,
  });
  metrics.trackValue('revenue', order.total, { currency: order.currency });
  revenue.record(order.total, { currency: order.currency });
});
```

- Emits OpenTelemetry counters/histograms via the OTLP endpoint configured in `init()`.
- Infrastructure metrics are enabled by default in **every** environment.

### Product Events (PostHog, Mixpanel, Amplitude, …)

Track user behavior, conversion funnels, and business outcomes alongside your OpenTelemetry traces.

**Recommended: Configure subscribers in `init()`, use global `track()` function:**

```typescript
import { init, track, trace } from 'autotel';
import { PostHogSubscriber } from 'autotel-subscribers/posthog';

init({
  service: 'checkout',
  subscribers: [new PostHogSubscriber({ apiKey: process.env.POSTHOG_KEY! })],
});

export const signup = trace('user.signup', async (user) => {
  // All events use subscribers from init() automatically
  track('user.signup', { userId: user.id, plan: user.plan });
  track.funnelStep('checkout', 'completed', { cartValue: user.cartTotal });
  track.value('lifetimeValue', user.cartTotal, { currency: 'USD' });
  track.outcome('user.signup', 'success', { cohort: user.cohort });
});
```

**Event instance (inherits subscribers from `init()`):**

```typescript
import { Event } from 'autotel/event';

// Uses subscribers configured in init() - no need to pass them again
const events = new Event('checkout');

events.trackEvent('order.completed', { amount: 99.99 });
events.trackFunnelStep('checkout', 'started', { cartValue: 99.99 });
```

**Override subscribers for specific Event instance:**

```typescript
import { Event } from 'autotel/event';
import { MixpanelSubscriber } from 'autotel-subscribers/mixpanel';

// Override: use different subscribers for this instance (multi-tenant, A/B testing, etc.)
const marketingEvents = new Event('marketing', {
  subscribers: [new MixpanelSubscriber({ token: process.env.MIXPANEL_TOKEN! })],
});

marketingEvents.trackEvent('campaign.viewed', { campaignId: '123' });
```

**Subscriber Resolution:**

- If `subscribers` passed to Event constructor → uses those (instance override)
- If no `subscribers` passed → falls back to `init()` subscribers (global config)
- If neither configured → events logged only (graceful degradation)

Auto-enrichment adds `traceId`, `spanId`, `correlationId`, `operation.name`, `service.version`, and `deployment.environment` to every event payload without manual wiring.

## Logging with Trace Context

**Bring your own logger** (Pino, Winston, Bunyan, etc.) and autotel automatically instruments it to:

- Inject trace context (`traceId`, `spanId`, `correlationId`) into every log record
- Record errors in the active OpenTelemetry span
- Bridge logs to the OpenTelemetry Logs API for OTLP export to Grafana, Datadog, etc.

### Using Pino (recommended)

**Note:** While `@opentelemetry/auto-instrumentations-node` includes Pino instrumentation, you may need to install `@opentelemetry/instrumentation-pino` separately for trace context injection to work reliably.

```bash
npm install pino
# Optional but recommended:
npm install @opentelemetry/instrumentation-pino
```

```typescript
import pino from 'pino';
import { init, trace } from 'autotel';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
});

init({
  service: 'user-service',
  logger,
  autoInstrumentations: ['pino'], // Enable Pino instrumentation for trace context
});

export const createUser = trace(async (data: UserData) => {
  logger.info({ userId: data.id }, 'Creating user');
  try {
    const user = await db.users.create(data);
    logger.info({ userId: user.id }, 'User created');
    return user;
  } catch (error) {
    logger.error({ err: error, userId: data.id }, 'Create failed');
    throw error;
  }
});
```

### Using Winston

**Note:** While `@opentelemetry/auto-instrumentations-node` includes Winston instrumentation, you must install `@opentelemetry/instrumentation-winston` separately for trace context injection to work.

```bash
npm install winston @opentelemetry/instrumentation-winston
```

```typescript
import winston from 'winston';
import { init } from 'autotel';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
});

init({
  service: 'user-service',
  logger,
  autoInstrumentations: ['winston'], // Enable Winston instrumentation for trace context
});
```

### Using Bunyan (or other loggers)

**Note:** While `@opentelemetry/auto-instrumentations-node` includes Bunyan instrumentation, you must install `@opentelemetry/instrumentation-bunyan` separately for trace context injection to work.

```bash
npm install bunyan @opentelemetry/instrumentation-bunyan
```

```typescript
import bunyan from 'bunyan';
import { init } from 'autotel';

const logger = bunyan.createLogger({ name: 'user-service' });

init({
  service: 'user-service',
  logger,
  autoInstrumentations: ['bunyan'], // Enable Bunyan instrumentation for trace context
});
```

**Note:** For manual instrumentation configuration, you can also use:

```typescript
import { BunyanInstrumentation } from '@opentelemetry/instrumentation-bunyan';

init({
  service: 'user-service',
  logger,
  instrumentations: [new BunyanInstrumentation()], // Manual instrumentation with custom config
});
```

**Can't find your logger?** Check [OpenTelemetry JS Contrib](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages) for available instrumentations, or [open an issue](https://github.com/jagreehal/autotel/issues) to request official support!

### What you get automatically

- ✅ Logs include `traceId`, `spanId`, `correlationId` for correlation with traces
- ✅ Errors are automatically recorded in the active span
- ✅ Logs export via OTLP to your observability backend (Grafana, Datadog, etc.)
- ✅ Simple setup - install the instrumentation package and enable it in `autoInstrumentations`

## Canonical Log Lines (Wide Events)

**Canonical log lines** implement the "wide events" pattern: one comprehensive log line per request with ALL context. This makes logs queryable as structured data instead of requiring string search.

**Key Benefits:**

- **One log line per request** with all context (user, cart, payment, errors, etc.)
- **High-cardinality, high-dimensionality data** for powerful queries
- **Automatic** - no manual logging needed, just use `trace()` and `ctx.setAttribute()`
- **Queryable** - `WHERE user.id = 'user-123' AND error.code IS NOT NULL`

### Basic Usage

```typescript
import { init, trace, setUser, httpServer } from 'autotel';
import pino from 'pino';

const logger = pino();
init({
  service: 'checkout-api',
  logger,
  canonicalLogLines: {
    enabled: true,
    rootSpansOnly: true, // One canonical log line per request
    logger, // Use Pino for canonical log lines
  },
});

export const processCheckout = trace((ctx) => async (order: Order) => {
  setUser(ctx, {
    id: order.userId,
    subscription: order.plan,
    accountAgeDays: daysSince(order.userCreatedAt),
  });

  httpServer(ctx, {
    method: 'POST',
    route: '/api/checkout',
    statusCode: 200,
  });

  ctx.setAttributes({
    'cart.total_cents': order.total,
    'payment.method': order.paymentMethod,
    'payment.provider': 'stripe',
  });

  // When this span ends, a canonical log line is automatically emitted
  // with ALL attributes: user.id, user.subscription, cart.total_cents, etc.
});
```

### What You Get

When a span ends, a canonical log line is automatically emitted with:

- **Core fields**: `operation`, `traceId`, `spanId`, `correlationId`, `duration_ms`, `status_code`
- **ALL span attributes**: Every attribute you set with `ctx.setAttribute()`
- **Resource attributes**: `service.name`, `service.version`, `deployment.environment`
- **Timestamp**: ISO 8601 format

**Example canonical log line:**

```json
{
  "level": "info",
  "msg": "[processCheckout] Request completed",
  "operation": "processCheckout",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "spanId": "00f067aa0ba902b7",
  "correlationId": "4bf92f3577b34da",
  "duration_ms": 124.7,
  "status_code": 1,
  "user.id": "user-123",
  "user.subscription": "premium",
  "user.account_age_days": 847,
  "cart.total_cents": 15999,
  "payment.method": "card",
  "payment.provider": "stripe",
  "service.name": "checkout-api",
  "timestamp": "2024-01-15T10:23:45.612Z"
}
```

### Query Examples

With canonical log lines, you can run powerful queries:

```sql
-- Find all checkout failures for premium users
SELECT * FROM logs
WHERE user.subscription = 'premium'
  AND error.code IS NOT NULL;

-- Group errors by code
SELECT error.code, COUNT(*)
FROM logs
WHERE error.code IS NOT NULL
GROUP BY error.code;

-- Find slow checkouts with coupons
SELECT * FROM logs
WHERE duration_ms > 200
  AND cart.coupon_applied IS NOT NULL;
```

### Configuration Options

```typescript
init({
  service: 'my-app',
  canonicalLogLines: {
    enabled: true,
    rootSpansOnly: true, // Only log root spans (one per request)
    minLevel: 'info', // Minimum log level ('debug' | 'info' | 'warn' | 'error')
    logger: pino(), // Custom logger (defaults to OTel Logs API)
    messageFormat: (span) => {
      // Custom message format
      const status = span.status.code === 2 ? 'ERROR' : 'SUCCESS';
      return `${span.name} [${status}]`;
    },
    includeResourceAttributes: true, // Include service.name, service.version, etc.
  },
});
```

## Auto Instrumentation & Advanced Configuration

- `autoInstrumentations` – Enable OpenTelemetry auto-instrumentations (HTTP, Express, Fastify, Prisma, Pino…). Requires `@opentelemetry/auto-instrumentations-node`.
- `instrumentations` – Provide manual instrumentation instances, e.g., `new HttpInstrumentation()`.
- `resource` / `resourceAttributes` – Declare cluster/region/tenant metadata once and it flows everywhere.
- `spanProcessor`, `metricReader`, `logRecordProcessors` – Plug in any OpenTelemetry exporter or your in-house pipeline.
- `headers` – Attach vendor auth headers when using the built-in OTLP HTTP exporters.
- `sdkFactory` – Receive the Autotel defaults and return a fully customized `NodeSDK` for the rare cases you need complete control.

```typescript
import { init } from 'autotel';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';

init({
  service: 'checkout',
  environment: 'production',
  resourceAttributes: {
    'cloud.region': 'us-east-1',
    'deployment.environment': 'production',
  },
  autoInstrumentations: ['http', 'express', 'pino'],
  instrumentations: [new HttpInstrumentation()],
  headers: 'Authorization=Basic ...',
  subscribers: [new PostHogSubscriber({ apiKey: 'phc_xxx' })],
});
```

### ⚠️ autoInstrumentations vs. Manual Instrumentations

When using both `autoInstrumentations` and `instrumentations`, manual instrumentations always take precedence. If you need custom configs (like `requireParentSpan: false` for standalone scripts), use **one or the other**:

#### Option A: Auto-instrumentations only (all defaults)

```typescript
init({
  service: 'my-app',
  autoInstrumentations: true, // All libraries with default configs
});
```

#### Option B: Manual instrumentations with custom configs

```typescript
import { MongoDBInstrumentation } from '@opentelemetry/instrumentation-mongodb';
import { MongooseInstrumentation } from '@opentelemetry/instrumentation-mongoose';

init({
  service: 'my-app',
  autoInstrumentations: false, // Must be false to avoid conflicts
  instrumentations: [
    new MongoDBInstrumentation({
      requireParentSpan: false, // Custom config for scripts/cron jobs
    }),
    new MongooseInstrumentation({
      requireParentSpan: false,
    }),
  ],
});
```

#### Option C: Mix auto + manual (best of both)

```typescript
import { MongoDBInstrumentation } from '@opentelemetry/instrumentation-mongodb';

init({
  service: 'my-app',
  autoInstrumentations: ['http', 'express'], // Auto for most libraries
  instrumentations: [
    // Manual config only for libraries that need custom settings
    new MongoDBInstrumentation({
      requireParentSpan: false,
    }),
  ],
});
```

**Why `requireParentSpan` matters:** Many instrumentations default to `requireParentSpan: true`, which prevents spans from being created in standalone scripts, cron jobs, or background workers without an active parent span. Set it to `false` for these use cases.

### ⚠️ Auto-Instrumentation Setup Requirements

OpenTelemetry's auto-instrumentation packages require special setup depending on your module system:

**ESM Setup (Recommended for Node 18.19+)**

Use `autotel/register` for clean ESM instrumentation without complex `NODE_OPTIONS`:

```typescript
// instrumentation.mjs (or .ts)
import 'autotel/register'; // MUST be first import!
import { init } from 'autotel';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

init({
  service: 'my-app',
  instrumentations: getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-pino': { enabled: true },
  }),
});
```

```bash
# Run with --import flag
tsx --import ./instrumentation.mjs src/server.ts
# or with Node
node --import ./instrumentation.mjs src/server.js
```

**Requirements for ESM instrumentation:**

- Install `@opentelemetry/auto-instrumentations-node` as a **direct dependency** in your app
- Import `autotel/register` **before** any other imports
- Use `--import` flag (not `--require`)

**CommonJS Setup**

No special flags required. Just use `--require`:

```json
// package.json
{
  "type": "commonjs" // or remove "type" field
}
```

```bash
node --require ./instrumentation.js src/server.js
```

**Zero-Config ESM (reads from env vars):**

```bash
OTEL_SERVICE_NAME=my-app tsx --import autotel/auto src/index.ts
```

**Legacy ESM (Node 18.0-18.18)**

If you can't use `autotel/register`, use the `--experimental-loader` flag:

```bash
NODE_OPTIONS="--experimental-loader=@opentelemetry/instrumentation/hook.mjs --import ./instrumentation.ts" tsx src/server.ts
```

**Note:** The loader hook is an OpenTelemetry upstream requirement for ESM, not an autotel limitation. See [OpenTelemetry ESM docs](https://opentelemetry.io/docs/languages/js/getting-started/nodejs/#esm-support) for details.

## Operational Safety & Runtime Controls

- **Adaptive sampling** – 10% baseline, 100% for errors/slow spans by default (override via `sampler`).
- **Rate limiting & circuit breakers** – Prevent telemetry storms when backends misbehave.
- **Validation** – Configurable attribute/event name lengths, maximum counts, and nesting depth.
- **Sensitive data redaction** – Passwords, tokens, API keys, and any custom regex you provide are automatically masked before export.
- **Auto-flush** – Events buffers drain when root spans end (disable with `flushOnRootSpanEnd: false`).
- **Runtime flags** – Toggle metrics or swap endpoints via env vars without code edits.

```bash
# Disable metrics without touching code (metrics are ON by default)
AUTOTEL_METRICS=off node server.js

# Point at a different collector
OTLP_ENDPOINT=https://otel.mycompany.com node server.js
```

## Configuration Reference

```typescript
init({
  service: string; // required
  subscribers?: EventSubscriber[];
  endpoint?: string;
  protocol?: 'http' | 'grpc'; // OTLP protocol (default: 'http')
  metrics?: boolean | 'auto';
  sampler?: Sampler;
  version?: string;
  environment?: string;
  baggage?: boolean | string; // Auto-copy baggage to span attributes
  flushOnRootSpanEnd?: boolean;  // Auto-flush events (default: true)
  forceFlushOnShutdown?: boolean;  // Force-flush spans on shutdown (default: false)
  autoInstrumentations?: string[] | boolean | Record<string, { enabled?: boolean }>;
  instrumentations?: NodeSDKConfiguration['instrumentations'];
  spanProcessor?: SpanProcessor;
  metricReader?: MetricReader;
  logRecordProcessors?: LogRecordProcessor[];
  resource?: Resource;
  resourceAttributes?: Record<string, string>;
  headers?: Record<string, string> | string;
  sdkFactory?: (defaults: NodeSDK) => NodeSDK;
  validation?: Partial<ValidationConfig>;
  logger?: Logger; // created via createLogger() or bring your own
  openllmetry?: {
    enabled: boolean;
    options?: Record<string, unknown>; // Passed to @traceloop/node-server-sdk
  };
});
```

**Event Subscribers:**

Configure event subscribers globally to send product events to PostHog, Mixpanel, Amplitude, etc.:

```typescript
import { init } from 'autotel';
import { PostHogSubscriber } from 'autotel-subscribers/posthog';

init({
  service: 'my-app',
  subscribers: [new PostHogSubscriber({ apiKey: process.env.POSTHOG_KEY! })],
});
```

Event instances automatically inherit these subscribers unless you explicitly override them. See [Product Events](#product-events-posthog-mixpanel-amplitude-) for details.

**Baggage Configuration:**

Enable automatic copying of baggage entries to span attributes:

```typescript
init({
  service: 'my-app',
  baggage: true, // Copies baggage to span attributes with 'baggage.' prefix
});

// With custom prefix
init({
  service: 'my-app',
  baggage: 'ctx', // Copies with 'ctx.' prefix → ctx.tenant.id
});

// No prefix
init({
  service: 'my-app',
  baggage: '', // Copies directly → tenant.id
});
```

This eliminates the need to manually call `ctx.setAttribute()` for baggage values. See [Baggage (Context Propagation)](#baggage-context-propagation) for usage examples.

**Protocol Configuration:**

Use the `protocol` parameter to switch between HTTP/protobuf (default) and gRPC:

```typescript
// HTTP (default) - uses port 4318
init({
  service: 'my-app',
  protocol: 'http', // or omit (defaults to http)
  endpoint: 'http://localhost:4318',
});

// gRPC - uses port 4317, better performance
init({
  service: 'my-app',
  protocol: 'grpc',
  endpoint: 'localhost:4317',
});
```

**Vendor Backend Configurations:**

For simplified setup with popular observability platforms, see [`autotel-backends`](../autotel-backends):

```bash
npm install autotel-backends
```

```typescript
import { init } from 'autotel';
import { createDatadogConfig } from 'autotel-backends/datadog';
import { createHoneycombConfig } from 'autotel-backends/honeycomb';

// Datadog
init(
  createDatadogConfig({
    apiKey: process.env.DATADOG_API_KEY!,
    service: 'my-app',
    environment: 'production',
  }),
);

// Honeycomb (automatically uses gRPC)
init(
  createHoneycombConfig({
    apiKey: process.env.HONEYCOMB_API_KEY!,
    service: 'my-app',
    environment: 'production',
    dataset: 'production', // optional, for classic accounts
  }),
);
```

**Environment Variables:**

Autotel supports standard OpenTelemetry environment variables for zero-code configuration across environments:

```bash
# Service configuration
export OTEL_SERVICE_NAME=my-app

# OTLP collector endpoint
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# Protocol: 'http' or 'grpc' (default: 'http')
export OTEL_EXPORTER_OTLP_PROTOCOL=http

# Authentication headers (comma-separated key=value pairs)
export OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=YOUR_API_KEY

# Resource attributes (comma-separated key=value pairs)
export OTEL_RESOURCE_ATTRIBUTES=service.version=1.2.3,deployment.environment=production,team=backend
```

**Configuration Precedence:** Explicit `init()` config > env vars > defaults

**Example: Honeycomb with env vars**

```bash
export OTEL_SERVICE_NAME=my-app
export OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io
export OTEL_EXPORTER_OTLP_PROTOCOL=grpc
export OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=YOUR_API_KEY
export OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production
```

**Example: Datadog with env vars**

```bash
export OTEL_SERVICE_NAME=my-app
export OTEL_EXPORTER_OTLP_ENDPOINT=https://http-intake.logs.datadoghq.com
export OTEL_EXPORTER_OTLP_HEADERS=DD-API-KEY=YOUR_API_KEY
export OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production
```

See `packages/autotel/.env.example` for a complete template.

Validation tuning example:

```typescript
init({
  service: 'checkout',
  validation: {
    sensitivePatterns: [/password/i, /secret/i, /creditCard/i],
    maxAttributeValueLength: 5_000,
    maxAttributeCount: 100,
    maxNestingDepth: 5,
  },
});
```

## Building Custom Instrumentation

Autotel is designed as an **enabler** - it provides composable primitives that let you instrument anything in your codebase. Here's how to use the building blocks to create custom instrumentation for queues, cron jobs, and other patterns.

### Instrumenting Queue Consumers

```typescript
import { trace, span, track } from 'autotel';

// Wrap your consumer handler with trace()
export const processMessage = trace(async function processMessage(
  message: Message,
) {
  // Use span() to break down processing stages
  await span({ name: 'parse.message' }, async (ctx) => {
    ctx.setAttribute('message.id', message.id);
    ctx.setAttribute('message.type', message.type);
    return parseMessage(message);
  });

  await span({ name: 'validate.message' }, async () => {
    return validateMessage(message);
  });

  await span({ name: 'process.business.logic' }, async () => {
    return handleMessage(message);
  });

  // Track events
  track('message.processed', {
    messageType: message.type,
    processingTime: Date.now() - message.timestamp,
  });
});

// Use in your queue consumer
consumer.on('message', async (msg) => {
  await processMessage(msg);
});
```

### Instrumenting Scheduled Jobs / Cron

```typescript
import { trace, getMetrics } from 'autotel';

export const dailyReportJob = trace(async function dailyReportJob() {
  const metrics = getMetrics();
  const startTime = Date.now();

  try {
    const report = await generateReport();

    // Record success metrics
    metrics.recordHistogram('job.duration', Date.now() - startTime, {
      job_name: 'daily_report',
      status: 'success',
    });

    return report;
  } catch (error) {
    // Record failure metrics
    metrics.recordHistogram('job.duration', Date.now() - startTime, {
      job_name: 'daily_report',
      status: 'error',
    });
    throw error;
  }
});

// Schedule with your preferred library
cron.schedule('0 0 * * *', () => dailyReportJob());
```

### Creating Custom Event Subscribers

Implement the `EventSubscriber` interface to send events to any events platform:

```typescript
import { type EventSubscriber, type EventAttributes } from 'autotel';

export class CustomEventSubscriber implements EventSubscriber {
  constructor(private config: { apiKey: string; endpoint: string }) {}

  async track(
    eventName: string,
    attributes: EventAttributes,
    timestamp: Date,
  ): Promise<void> {
    await fetch(this.config.endpoint, {
      method: 'POST',
      headers: { 'X-API-Key': this.config.apiKey },
      body: JSON.stringify({
        event: eventName,
        properties: attributes,
        timestamp,
      }),
    });
  }

  async identify(userId: string, traits: EventAttributes): Promise<void> {
    // Implement user identification
  }

  async flush(): Promise<void> {
    // Implement flush if buffering
  }
}

// Use it in init()
init({
  service: 'my-app',
  subscribers: [new CustomEventSubscriber({ apiKey: '...', endpoint: '...' })],
});
```

### Low-Level Span Manipulation

For maximum control, use the `ctx` proxy or the ergonomic tracer helpers:

```typescript
import { ctx, getTracer, getActiveSpan, runWithSpan } from 'autotel';

export async function customWorkflow() {
  // Access current trace context anywhere (via AsyncLocalStorage)
  console.log('Current trace:', ctx.traceId);
  ctx.setAttribute('workflow.step', 'start');

  // Or create custom spans with the tracer helpers
  const tracer = getTracer('my-custom-tracer');
  const span = tracer.startSpan('custom.operation');

  try {
    // Your logic here
    span.setAttribute('custom.attribute', 'value');
    span.setStatus({ code: SpanStatusCode.OK });
  } finally {
    span.end();
  }
}

// Add attributes and events to the currently active span
export function enrichCurrentSpan(userId: string) {
  const span = getActiveSpan();
  if (span) {
    span.setAttribute('user.id', userId);
    span.addEvent('User identified', { userId, timestamp: Date.now() });
  }
}

// Add events with attributes (e.g., queue operations)
export async function processQueue() {
  const span = getActiveSpan();
  if (span) {
    span.addEvent('queue.wait', {
      queue_size: 42,
      queue_name: 'order-processing',
    });
    // Process queue...
  }
}

// Run code with a specific span as active
export async function backgroundJob() {
  const tracer = getTracer('background-processor');
  const span = tracer.startSpan('process.batch');

  try {
    await runWithSpan(span, async () => {
      // Any spans created here will be children of 'process.batch'
      await processRecords();
    });
    span.setStatus({ code: SpanStatusCode.OK });
  } catch (error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR });
  } finally {
    span.end();
  }
}
```

**Available tracer helpers:**

- `getTracer(name, version?)` - Get a tracer for creating custom spans
- `getActiveSpan()` - Get the currently active span
- `getActiveContext()` - Get the current OpenTelemetry context
- `runWithSpan(span, fn)` - Execute a function with a span set as active

> **Note:** For most use cases, prefer `trace()`, `span()`, or `instrument()` which handle span lifecycle automatically.

### Custom Metrics

Create custom business metrics using the meter helpers:

```typescript
import { getMeter, createCounter, createHistogram } from 'autotel';

// Create custom metrics
const requestCounter = createCounter('http.requests.total', {
  description: 'Total HTTP requests',
});

const responseTimeHistogram = createHistogram('http.response.time', {
  description: 'HTTP response time in milliseconds',
  unit: 'ms',
});

export async function handleRequest(req: Request) {
  const startTime = Date.now();

  requestCounter.add(1, { method: req.method, path: req.path });

  const response = await processRequest(req);

  responseTimeHistogram.record(Date.now() - startTime, {
    method: req.method,
    status: response.status,
  });

  return response;
}
```

**Key Principle:** All these primitives work together - spans automatically capture context, metrics and events inherit trace IDs, and everything flows through the same configured exporters and adapters. Build what you need, when you need it.

## Serverless & Short-lived Processes

For serverless environments (AWS Lambda, Vercel, Cloud Functions) and other short-lived processes, telemetry may not export before the process ends. Autotel provides two approaches:

### Manual Flush (Recommended for Serverless)

Use the `flush()` function to force-export all telemetry before the function returns:

```typescript
import { init, flush } from 'autotel';

init({
  service: 'my-lambda',
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});

export const handler = async (event) => {
  // Your business logic here
  const result = await processEvent(event);

  // Force-flush telemetry before returning
  await flush();

  return result;
};
```

The `flush()` function:

- Flushes events from the queue
- Force-flushes OpenTelemetry spans to exporters
- Includes timeout protection (default: 2000ms)
- Safe to call multiple times

**Custom timeout:**

```typescript
await flush({ timeout: 5000 }); // 5 second timeout
```

### Auto-Flush Spans (Opt-in)

Enable automatic span flushing on root span completion:

```typescript
init({
  service: 'my-lambda',
  flushOnRootSpanEnd: true, // enabled by default (events only)
  forceFlushOnShutdown: true, // flush spans on root completion
});

export const handler = trace(async (event) => {
  // Auto-flushes when trace completes
  return await processEvent(event);
});
```

**Trade-offs:**

- ✅ Zero boilerplate - no manual `flush()` needed
- ✅ Guaranteed export before process ends (async functions only)
- ⚠️ Adds ~50-200ms latency per request (network I/O)
- ⚠️ Only needed for short-lived processes
- ⚠️ Only applies to async traced functions (synchronous functions cannot await flush)

**When to use:**

- Use `forceFlushOnShutdown: true` for serverless functions where latency is acceptable
- Use manual `flush()` for more control over when flushing occurs
- Use neither for long-running services (batch export is more efficient)

### Edge Runtimes (Cloudflare Workers, Vercel Edge)

For edge runtimes with different constraints, use the `autotel-edge` package instead:

```typescript
import { init } from 'autotel-edge';
// Auto-flush built-in for edge environments
```

The `autotel-edge` package is optimized for edge runtimes with automatic flush behavior.

## API Reference

- `init(config)` – Bootstraps the SDK (call once).
- `trace(fn | name, fn)` – Wraps functions with spans and optional context access.
- `span(options, fn)` – Creates nested spans for ad-hoc blocks.
- `withTracing(options)` – Produces reusable wrappers with shared configuration.
- `instrument(target, options)` – Batch-wraps an object of functions.
- `Trace` decorator – Adds tracing to class methods (TypeScript 5+).
- `instrumentDatabase(db, options)` – Adds automatic DB spans (Drizzle, etc.).
- `Metric` class & helpers (`createHistogram`, etc.) – Emit OpenTelemetry metrics.
- `Event` class & `track()` helper – Send product events/funnels/outcomes/values via subscribers.
- `Logger` interface – Bring your own Pino/Winston logger; autotel auto-instruments it for trace context and OTLP export.
- `PostHogSubscriber`, `MixpanelSubscriber`, … – Provided in `autotel-subscribers`; create your own by implementing the `EventSubscriber` interface.

Each API is type-safe, works in both ESM and CJS, and is designed to minimize boilerplate while staying close to OpenTelemetry primitives.

## FAQ & Next Steps

- **Do I need to abandon my current tooling?** No. Autotel layers on top of OpenTelemetry and forwards to whatever you already use (Datadog, Grafana, Tempo, Honeycomb, etc.).
- **Is this just for traces?** No. Spans, metrics, logs, and events all share the same context and exporters.
- **Can I customize everything?** Yes. Override exporters, readers, resources, validation, or even the full NodeSDK via `sdkFactory`.
- **Does it work in production?** Yes. Adaptive sampling, redaction, validation, rate limiting, and circuit breakers are enabled out of the box.
- **What about frameworks?** Use decorators, `withTracing()`, or `instrument()` for NestJS, Fastify, Express, Next.js actions, queues, workers, anything in Node.js.

**Next steps:**

1. `npm install autotel` and call `init()` at startup.
2. Wrap your critical paths with `trace()` (or `Trace` decorators if you prefer classes).
3. Point the OTLP endpoint at your favorite observability backend and optionally add events adapters.
4. Expand coverage with `instrumentDatabase()`, `withTracing()`, metrics, logging, and auto-instrumentations.

## Troubleshooting & Debugging

### Quick Debug Mode (Recommended)

The simplest way to see spans locally during development - perfect for progressive development:

```typescript
import { init } from 'autotel';

// Start with console-only (no backend needed)
init({
  service: 'my-app',
  debug: true, // Outputs spans to console
});

// Later: add endpoint to send to backend while keeping console output
init({
  service: 'my-app',
  debug: true,
  endpoint: 'https://otlp.datadoghq.com', // Now sends to both console AND Datadog
});

// Production: remove debug to send to backend only
init({
  service: 'my-app',
  endpoint: 'https://otlp.datadoghq.com', // Backend only (clean production config)
});
```

**How it Works:**

- **`debug: true`**: Print spans to console AND send to backend (if endpoint configured)
  - No endpoint = console-only (perfect for local development)
  - With endpoint = console + backend (verify before choosing provider)
- **No debug flag**: Export to backend only (default production behavior)

**Environment Variable:**

```bash
# Enable debug mode
AUTOTEL_DEBUG=true node server.js
# or
AUTOTEL_DEBUG=1 node server.js

# Disable debug mode
AUTOTEL_DEBUG=false node server.js
```

### Manual Configuration (Advanced)

When developing or debugging your instrumentation, you may want more control over span export. Autotel supports manual exporter configuration:

#### ConsoleSpanExporter (Visual Debugging)

Use `ConsoleSpanExporter` to print all spans to the console in real-time. This is great for:

- Quick visual inspection during development
- Seeing spans as they're created
- Debugging span structure and attributes
- Examples and demos

```typescript
import { init } from 'autotel';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';

init({
  service: 'my-app',
  spanExporter: new ConsoleSpanExporter(), // Prints spans to console
});
```

### InMemorySpanExporter (Testing & Assertions)

Use `InMemorySpanExporter` for programmatic access to spans in tests. This is ideal for:

- Writing test assertions on spans
- Querying spans by name or attributes
- Verifying instrumentation behavior
- Automated testing

```typescript
import { init } from 'autotel';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';

const exporter = new InMemorySpanExporter();

init({
  service: 'test',
  spanProcessor: new SimpleSpanProcessor(exporter),
});

// After running your code...
const spans = exporter.getFinishedSpans();
expect(spans).toHaveLength(1);
expect(spans[0]?.name).toBe('my.operation');
```

### Using Both (Advanced)

For comprehensive debugging, use the `debug: true` option to combine console output with backend export. See the "Quick Debug Mode" section above for the recommended approach.

**Quick Reference:**

- **ConsoleSpanExporter**: See spans in console output (development/debugging)
- **InMemorySpanExporter**: Query spans programmatically (testing/assertions)

## Creating Custom Instrumentation

Autotel provides utilities that make it easy to instrument any library with OpenTelemetry tracing. Whether you need to instrument an internal tool, a database driver without official support, or any other library, autotel's helper functions handle the complexity for you.

### Quick Start Template

Here's the minimal code to instrument any library:

```typescript
import { trace, SpanKind } from '@opentelemetry/api';
import { runWithSpan, finalizeSpan } from 'autotel/trace-helpers';

const INSTRUMENTED_FLAG = Symbol('instrumented');

export function instrumentMyLibrary(client) {
  if (client[INSTRUMENTED_FLAG]) return client;

  const tracer = trace.getTracer('my-library');
  const originalMethod = client.someMethod.bind(client);

  client.someMethod = async function (...args) {
    const span = tracer.startSpan('operation.name', {
      kind: SpanKind.CLIENT,
    });

    span.setAttribute('operation.param', args[0]);

    try {
      const result = await runWithSpan(span, () => originalMethod(...args));
      finalizeSpan(span);
      return result;
    } catch (error) {
      finalizeSpan(span, error);
      throw error;
    }
  };

  client[INSTRUMENTED_FLAG] = true;
  return client;
}
```

### Step-by-Step Tutorial: Instrumenting Axios

Let's walk through instrumenting the popular axios HTTP client:

```typescript
import { trace, SpanKind } from '@opentelemetry/api';
import { runWithSpan, finalizeSpan } from 'autotel/trace-helpers';
import type { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';

// Step 1: Create instrumentation flag to prevent double-instrumentation
const INSTRUMENTED_FLAG = Symbol('axiosInstrumented');

interface InstrumentedAxios {
  [INSTRUMENTED_FLAG]?: boolean;
}

// Step 2: Define configuration for your instrumentation
export interface InstrumentAxiosConfig {
  tracerName?: string;
  captureHeaders?: boolean;
  captureRequestBody?: boolean;
  captureResponseBody?: boolean;
}

// Step 3: Create the instrumentation function
export function instrumentAxios(
  axios: AxiosInstance,
  config?: InstrumentAxiosConfig,
): AxiosInstance {
  const instrumented = axios as AxiosInstance & InstrumentedAxios;

  // Idempotent check
  if (instrumented[INSTRUMENTED_FLAG]) {
    return axios;
  }

  const {
    tracerName = 'axios-http-client',
    captureHeaders = false,
    captureRequestBody = false,
    captureResponseBody = false,
  } = config ?? {};

  // Step 4: Get tracer instance
  const tracer = trace.getTracer(tracerName);

  // Step 5: Add request interceptor to start spans
  axios.interceptors.request.use((requestConfig: AxiosRequestConfig) => {
    const url = requestConfig.url || '';
    const method = requestConfig.method?.toUpperCase() || 'GET';

    // Step 6: Start span with appropriate attributes
    const span = tracer.startSpan(`HTTP ${method}`, {
      kind: SpanKind.CLIENT,
    });

    // Follow OpenTelemetry semantic conventions
    span.setAttribute('http.method', method);
    span.setAttribute('http.url', url);

    if (captureHeaders && requestConfig.headers) {
      span.setAttribute(
        'http.request.headers',
        JSON.stringify(requestConfig.headers),
      );
    }

    if (captureRequestBody && requestConfig.data) {
      span.setAttribute(
        'http.request.body',
        JSON.stringify(requestConfig.data),
      );
    }

    // Store span in request config for response interceptor
    (requestConfig as any).__span = span;

    return requestConfig;
  });

  // Step 7: Add response interceptor to finalize spans
  axios.interceptors.response.use(
    (response: AxiosResponse) => {
      const span = (response.config as any).__span;
      if (span) {
        span.setAttribute('http.status_code', response.status);

        if (captureResponseBody && response.data) {
          span.setAttribute(
            'http.response.body',
            JSON.stringify(response.data),
          );
        }

        // Step 8: Finalize span on success
        finalizeSpan(span);
      }
      return response;
    },
    (error) => {
      const span = error.config?.__span;
      if (span) {
        if (error.response) {
          span.setAttribute('http.status_code', error.response.status);
        }
        // Step 9: Finalize span on error (records exception)
        finalizeSpan(span, error);
      }
      return Promise.reject(error);
    },
  );

  // Step 10: Mark as instrumented
  instrumented[INSTRUMENTED_FLAG] = true;
  return axios;
}

// Usage:
import axios from 'axios';
import { init } from 'autotel';

init({ service: 'my-api' });

const client = axios.create({ baseURL: 'https://api.example.com' });
instrumentAxios(client, { captureHeaders: true });

// All requests are now traced
await client.get('/users');
```

### Best Practices

#### 1. Idempotent Instrumentation

Always use symbols or flags to prevent double-instrumentation:

```typescript
const INSTRUMENTED_FLAG = Symbol('instrumented');

export function instrument(client) {
  if (client[INSTRUMENTED_FLAG]) {
    return client; // Already instrumented
  }

  // ... instrumentation code ...

  client[INSTRUMENTED_FLAG] = true;
  return client;
}
```

#### 2. Error Handling

Always use try/catch with `finalizeSpan` to ensure spans are properly closed:

```typescript
try {
  const result = await runWithSpan(span, () => operation());
  finalizeSpan(span); // Sets OK status and ends span
  return result;
} catch (error) {
  finalizeSpan(span, error); // Records exception, sets ERROR status, ends span
  throw error;
}
```

#### 3. Security - Don't Capture Sensitive Data

Be extremely careful about what you capture in spans:

```typescript
export interface Config {
  captureQueryText?: boolean; // Default: false for security
  captureFilters?: boolean; // Default: false for security
  captureHeaders?: boolean; // Default: false for security
}

function instrument(client, config) {
  // Only capture if explicitly enabled
  if (config.captureQueryText) {
    span.setAttribute('db.statement', sanitize(query));
  }
}
```

#### 4. Follow OpenTelemetry Semantic Conventions

Use standard attribute names from [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/):

```typescript
// ✅ Good - Standard conventions
span.setAttribute('http.method', 'GET');
span.setAttribute('http.status_code', 200);
span.setAttribute('db.system', 'postgresql');
span.setAttribute('db.operation', 'SELECT');
span.setAttribute('messaging.system', 'kafka');

// ❌ Bad - Custom names
span.setAttribute('method', 'GET');
span.setAttribute('status', 200);
span.setAttribute('database', 'postgres');
```

#### 5. Choose the Right SpanKind

```typescript
import { SpanKind } from '@opentelemetry/api';

// CLIENT: Outgoing requests, database calls, API calls
tracer.startSpan('http.request', { kind: SpanKind.CLIENT });

// SERVER: Incoming requests (usually auto-instrumented)
tracer.startSpan('http.server', { kind: SpanKind.SERVER });

// INTERNAL: Internal operations, business logic
tracer.startSpan('process.data', { kind: SpanKind.INTERNAL });

// PRODUCER: Publishing messages to queues
tracer.startSpan('kafka.produce', { kind: SpanKind.PRODUCER });

// CONSUMER: Consuming messages from queues
tracer.startSpan('kafka.consume', { kind: SpanKind.CONSUMER });
```

#### 6. TypeScript Type Safety

Make your instrumentation type-safe:

```typescript
import type { MyLibrary } from 'my-library';

interface InstrumentedClient {
  __instrumented?: boolean;
}

export function instrument<T extends MyLibrary>(client: T, config?: Config): T {
  const instrumented = client as T & InstrumentedClient;
  // ... instrumentation ...
  return client;
}
```

### Available Utilities

Autotel provides these utilities for custom instrumentation:

#### From `autotel/trace-helpers`

```typescript
import {
  getTracer, // Get tracer instance
  runWithSpan, // Execute function with span as active context
  finalizeSpan, // Set status and end span with error handling
  getActiveSpan, // Get currently active span
  getTraceContext, // Get trace IDs for correlation
  enrichWithTraceContext, // Add trace context to objects
  getActiveContext, // Get current OpenTelemetry context
} from 'autotel/trace-helpers';

// Get a tracer
const tracer = getTracer('my-service', '1.0.0');

// Start a span
const span = tracer.startSpan('operation.name');

// Run code with span as active context
const result = await runWithSpan(span, async () => {
  // Any spans created here will be children of 'span'
  return await doWork();
});

// Finalize span (OK status if no error, ERROR status if error provided)
finalizeSpan(span); // Success
finalizeSpan(span, error); // Error

// Get current active span (to add attributes)
const currentSpan = getActiveSpan();
if (currentSpan) {
  currentSpan.setAttribute('user.id', userId);
}

// Get trace context for logging correlation
const context = getTraceContext();
// { traceId: '...', spanId: '...', correlationId: '...' }

// Enrich log objects with trace context
logger.info(
  enrichWithTraceContext({
    message: 'User logged in',
    userId: '123',
  }),
);
// Logs: { message: '...', userId: '123', traceId: '...', spanId: '...' }
```

#### From `@opentelemetry/api`

```typescript
import {
  trace, // Access to tracer provider
  context, // Context management (advanced)
  SpanKind, // CLIENT, SERVER, INTERNAL, PRODUCER, CONSUMER
  SpanStatusCode, // OK, ERROR, UNSET
  type Span, // Span interface
  type Tracer, // Tracer interface
} from '@opentelemetry/api';

// Span methods
span.setAttribute(key, value); // Add single attribute
span.setAttributes({ key: value }); // Add multiple attributes
span.addEvent('cache.hit'); // Add event (name only)
span.addEvent('queue.wait', { queue_size: 42 }); // Add event with attributes
span.recordException(error); // Record exception
span.setStatus({ code: SpanStatusCode.ERROR }); // Set status
span.end(); // End span
```

#### Semantic Conventions (Optional)

For database instrumentation, you can reuse constants from `autotel-plugins`:

```typescript
import {
  SEMATTRS_DB_SYSTEM,
  SEMATTRS_DB_OPERATION,
  SEMATTRS_DB_NAME,
  SEMATTRS_DB_STATEMENT,
  SEMATTRS_NET_PEER_NAME,
  SEMATTRS_NET_PEER_PORT,
} from 'autotel-plugins/common/constants';

span.setAttribute(SEMATTRS_DB_SYSTEM, 'postgresql');
span.setAttribute(SEMATTRS_DB_OPERATION, 'SELECT');
```

### Real-World Examples

**Complete instrumentation template:**
See [`INSTRUMENTATION_TEMPLATE.ts`](./INSTRUMENTATION_TEMPLATE.ts) for a comprehensive, commented template you can copy and customize.

**Production example:**
Check [`autotel-plugins/drizzle`](../autotel-plugins/src/drizzle/index.ts) for a real-world instrumentation of Drizzle ORM showing:

- Idempotent instrumentation
- Multiple instrumentation levels (client, database, session)
- Configuration options
- Security considerations (query text capture)
- Full TypeScript support

### When to Create Custom Instrumentation

✅ **Create custom instrumentation when:**

- No official `@opentelemetry/instrumentation-*` package exists
- You're instrumenting internal tools or proprietary libraries
- You need more control over captured data
- You want simpler configuration than official packages

❌ **Use official packages when available:**

- MongoDB: `@opentelemetry/instrumentation-mongodb`
- Mongoose: `@opentelemetry/instrumentation-mongoose`
- PostgreSQL: `@opentelemetry/instrumentation-pg`
- MySQL: `@opentelemetry/instrumentation-mysql2`
- Redis: `@opentelemetry/instrumentation-redis`
- See all: [opentelemetry-js-contrib](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/plugins/node)

### Using Official Instrumentation

To use official OpenTelemetry instrumentation with autotel:

```typescript
import { init } from 'autotel';
import { MongoDBInstrumentation } from '@opentelemetry/instrumentation-mongodb';
import { RedisInstrumentation } from '@opentelemetry/instrumentation-redis';

init({
  service: 'my-service',
  instrumentations: [
    new MongoDBInstrumentation({
      enhancedDatabaseReporting: true,
    }),
    new RedisInstrumentation(),
  ],
});

// MongoDB and Redis operations are now automatically traced
```

Happy observing!
