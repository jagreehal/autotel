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
    - [Reusable Middleware Helpers](#reusable-middleware-helpers)
    - [Decorators (TypeScript 5+)](#decorators-typescript-5)
    - [Database Instrumentation](#database-instrumentation)
  - [Business Metrics \& Product Events](#business-metrics--product-events)
    - [OpenTelemetry Metrics (Metric class + helpers)](#opentelemetry-metrics-metric-class--helpers)
    - [Product Events (PostHog, Mixpanel, Amplitude, …)](#product-events-posthog-mixpanel-amplitude-)
  - [Logging with Trace Context](#logging-with-trace-context)
    - [Using Pino (recommended)](#using-pino-recommended)
    - [Using Winston](#using-winston)
    - [Using Bunyan (or other loggers)](#using-bunyan-or-other-loggers)
    - [What you get automatically](#what-you-get-automatically)
  - [Auto Instrumentation \& Advanced Configuration](#auto-instrumentation--advanced-configuration)
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
  otlpHeaders: 'dd-api-key=...',
});

init({
  service: 'my-app',
  // Honeycomb (gRPC protocol)
  protocol: 'grpc',
  endpoint: 'api.honeycomb.io:443',
  otlpHeaders: {
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
  logger.info('Handling request', { traceId: ctx.traceId });
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
  dbName: 'myapp',
});

await db.select().from(users); // queries emit spans automatically
```

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

```bash
npm install pino
```

```typescript
import pino from 'pino';
import { init, trace } from 'autotel';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
});

init({ service: 'user-service', logger });

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

```bash
npm install winston
```

```typescript
import winston from 'winston';
import { init } from 'autotel';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
});

init({ service: 'user-service', logger });
```

### Using Bunyan (or other loggers)

Autotel auto-detects Pino and Winston. For other loggers like Bunyan, manually add the instrumentation:

```bash
npm install bunyan @opentelemetry/instrumentation-bunyan
```

```typescript
import bunyan from 'bunyan';
import { init } from 'autotel';
import { BunyanInstrumentation } from '@opentelemetry/instrumentation-bunyan';

const logger = bunyan.createLogger({ name: 'user-service' });

init({
  service: 'user-service',
  logger,
  instrumentations: [new BunyanInstrumentation()], // Manual instrumentation
});
```

**Can't find your logger?** Check [OpenTelemetry JS Contrib](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages) for available instrumentations, or [open an issue](https://github.com/jagreehal/autotel/issues) to request official support!

### What you get automatically

- ✅ Logs include `traceId`, `spanId`, `correlationId` for correlation with traces
- ✅ Errors are automatically recorded in the active span
- ✅ Logs export via OTLP to your observability backend (Grafana, Datadog, etc.)
- ✅ Zero configuration for Pino/Winston - just pass your logger to `init()`

## Auto Instrumentation & Advanced Configuration

- `integrations` – Enable OpenTelemetry auto-instrumentations (HTTP, Express, Fastify, Prisma, Pino…). Requires `@opentelemetry/auto-instrumentations-node`.
- `instrumentations` – Provide manual instrumentation instances, e.g., `new HttpInstrumentation()`.
- `resource` / `resourceAttributes` – Declare cluster/region/tenant metadata once and it flows everywhere.
- `spanProcessor`, `metricReader`, `logRecordProcessors` – Plug in any OpenTelemetry exporter or your in-house pipeline.
- `otlpHeaders` – Attach vendor auth headers when using the built-in OTLP HTTP exporters.
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
  integrations: ['http', 'express', 'pino'],
  instrumentations: [new HttpInstrumentation()],
  otlpHeaders: 'Authorization=Basic ...',
  subscribers: [new PostHogSubscriber({ apiKey: 'phc_xxx' })],
});
```

### ⚠️ Integrations vs. Manual Instrumentations

When using both `integrations` and `instrumentations`, manual instrumentations always take precedence. If you need custom configs (like `requireParentSpan: false` for standalone scripts), use **one or the other**:

#### Option A: Auto-instrumentations only (all defaults)

```typescript
init({
  service: 'my-app',
  integrations: true, // All libraries with default configs
});
```

#### Option B: Manual instrumentations with custom configs

```typescript
import { MongoDBInstrumentation } from '@opentelemetry/instrumentation-mongodb';
import { MongooseInstrumentation } from '@opentelemetry/instrumentation-mongoose';

init({
  service: 'my-app',
  integrations: false, // Must be false to avoid conflicts
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
  integrations: ['http', 'express'], // Auto for most libraries
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

**CommonJS (Simpler - Recommended)**

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

**ESM (Requires Experimental Loader Hook)**

If you need ESM, use the `--experimental-loader` flag:

```bash
NODE_OPTIONS="--import ./instrumentation.mjs --experimental-loader=@opentelemetry/instrumentation/hook.mjs" node src/server.js
```

For tsx users:

```bash
NODE_OPTIONS="--experimental-loader=@opentelemetry/instrumentation/hook.mjs --import ./instrumentation.ts" tsx src/server.ts
```

**Note:** The loader hook is an OpenTelemetry upstream requirement for ESM, not an autotel limitation. Autotel itself works identically in both ESM and CJS. See [OpenTelemetry ESM docs](https://opentelemetry.io/docs/languages/js/getting-started/nodejs/#esm-support) for details.

## Operational Safety & Runtime Controls

- **Adaptive sampling** – 10% baseline, 100% for errors/slow spans by default (override via `sampler`).
- **Rate limiting & circuit breakers** – Prevent telemetry storms when backends misbehave.
- **Validation** – Configurable attribute/event name lengths, maximum counts, and nesting depth.
- **Sensitive data redaction** – Passwords, tokens, API keys, and any custom regex you provide are automatically masked before export.
- **Auto-flush** – Events buffers drain when root spans end (disable with `autoFlushEvents: false`).
- **Runtime flags** – Toggle metrics or swap endpoints via env vars without code edits.

```bash
# Disable metrics without touching code (metrics are ON by default)
AUTOTELEMETRY_METRICS=off node server.js

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
  autoFlushEvents?: boolean;  // Auto-flush events (default: true)
  autoFlush?: boolean;           // Auto-flush spans (default: false)
  integrations?: string[] | boolean | Record<string, { enabled?: boolean }>;
  instrumentations?: NodeSDKConfiguration['instrumentations'];
  spanProcessor?: SpanProcessor;
  metricReader?: MetricReader;
  logRecordProcessors?: LogRecordProcessor[];
  resource?: Resource;
  resourceAttributes?: Record<string, string>;
  otlpHeaders?: Record<string, string> | string;
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
  autoFlushEvents: true, // enabled by default (events only)
  autoFlush: true, // flush spans on root completion
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

- Use `autoFlush: true` for serverless functions where latency is acceptable
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
AUTOLEMETRY_DEBUG=true node server.js
# or
AUTOLEMETRY_DEBUG=1 node server.js

# Disable debug mode
AUTOLEMETRY_DEBUG=false node server.js
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
