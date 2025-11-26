# Cloudflare Example

This example demonstrates all features of `autotel-edge` for Cloudflare Workers:

## Features Demonstrated

- ✅ **HTTP Handler Instrumentation** - Automatic spans for fetch requests
- ✅ **Scheduled Handler** - Cron job instrumentation
- ✅ **Queue Handler** - Message processing with ack/retry tracking
- ✅ **Email Handler** - Email processing instrumentation
- ✅ **Auto-instrumented Bindings** - KV, R2, D1, and Service Bindings automatically traced
- ✅ **Global Fetch Instrumentation** - All fetch() calls traced
- ✅ **Global Cache Instrumentation** - Cache API operations traced
- ✅ **Adaptive Sampling** - Production-ready sampling (10% baseline, all errors, all slow requests)
- ✅ **Error Handling** - Proper span status codes and exception recording
- ✅ **Attribute Extractors** - Automatic attribute extraction from function args and results
- ✅ **Nested Spans** - Complex workflows with multiple nested operations
- ✅ **Code Block Tracing** - Using `span()` for tracing specific code blocks
- ✅ **Distributed Tracing** - Automatic trace context propagation across services
- ✅ **Fetch Span Customization** - postProcess callback for custom attributes
- ✅ **Disable Flag** - Option to disable instrumentation for local dev
- ✅ **Traced Functions** - Custom business logic tracing
- ✅ **Edge Logger** - Structured logging with trace correlation
- ✅ **Edge Adapters** - Events event tracking
- ✅ **Cloudflare Actors Integration** - Full lifecycle tracing for @cloudflare/actors (see [Actor Example](#actor-example))
- ✅ **Cloudflare Agents SDK Integration** - Full observability for Agents SDK RPC, scheduling, and MCP operations (see [Agent Example](#agent-example))

## Usage

### Development

```bash
pnpm dev
```

The worker will start on `http://localhost:8787` and automatically connect to your local OTLP endpoint at `http://localhost:4318/v1/traces`.

### Endpoints

**Main Worker (`src/worker.ts`):**
- `GET /` - Basic request processing with attribute extractors
- `GET /kv` - Demonstrates KV auto-instrumentation with attribute extractors (requires MY_KV binding)
- `GET /r2` - Demonstrates R2 auto-instrumentation (requires MY_R2 binding)
- `GET /d1` - Demonstrates D1 auto-instrumentation with result attributes (requires MY_D1 binding)
- `GET /service` - Demonstrates Service Binding auto-instrumentation (requires MY_SERVICE binding)
- `GET /cache` - Demonstrates cache instrumentation using `span()` for code blocks
- `GET /external` - Demonstrates distributed tracing with automatic context propagation
- `POST /payment` - Demonstrates error handling with proper span status codes
- `POST /users` - Demonstrates nested spans with validation and database operations

**Actor Worker (`src/actor-worker.ts`):**
See [Actor Example](#actor-example) section below for Actor-specific endpoints.

**Agent Worker (`src/agent-worker.ts`):**
See [Agent Example](#agent-example) section below for Agent-specific RPC methods.

### Environment Variables

- `OTLP_ENDPOINT` - OTLP exporter URL (defaults to `http://localhost:4318/v1/traces`)
- `OTLP_HEADERS` - JSON string of headers for OTLP exporter
- `ENVIRONMENT` - Set to `"production"` for production sampling, otherwise uses 100% sampling
- `DISABLE_INSTRUMENTATION` - Set to `"true"` to disable all instrumentation

### Bindings

Add bindings in `alchemy.run.ts` or `wrangler.toml`:

```typescript
export const worker = await Worker('hello-worker', {
  entrypoint: './src/worker.ts',
  compatibilityFlags: ['nodejs_compat'],
  // Add bindings here
});
```

## What Gets Traced

1. **HTTP Requests**: All fetch handler requests create spans with:
   - `http.request.method`
   - `url.full`
   - `http.response.status_code`
   - Custom attributes via `postProcess` callback

2. **Scheduled Tasks**: Cron jobs create spans with:
   - `faas.trigger` (timer)
   - `faas.cron`
   - `faas.scheduled_time`
   - `faas.coldstart`

3. **Queue Messages**: Queue processing creates spans with:
   - `queue.name`
   - `queue.messages_count`
   - `queue.messages_success`
   - `queue.messages_failed`
   - Events for `messageAck`, `messageRetry`, etc.

4. **Email Processing**: Email handlers create spans with:
   - `messaging.destination.name`
   - `rpc.message.id`
   - `email.header.*` (all headers)

5. **Cloudflare Bindings**: All binding operations create spans:
   - **KV**: `KV {namespace}: {operation}` spans
   - **R2**: `R2 {bucket}: {operation}` spans
   - **D1**: `D1 {database}: {operation}` spans
   - **Service Bindings**: `Service {name}: {method}` spans

6. **Traced Functions**: Custom functions wrapped with `trace()` create nested spans with:
   - Automatic span naming from function names
   - Attribute extraction from arguments and results
   - Proper error handling with span status codes
   - Exception recording for debugging

7. **Adaptive Sampling**: Production-ready sampling configuration:
   - **Production**: 10% baseline, all errors, all slow requests (>1s)
   - **Development**: 100% sampling for debugging
   - **High Traffic**: 1% baseline, all errors, slow >2s
   - **Debugging**: 50% baseline, all errors, slow >500ms

8. **Error Handling**: Proper error tracking with:
   - `SpanStatusCode.ERROR` for failed operations
   - Exception recording via `recordException()`
   - Error messages in span status
   - Automatic error detection in sampling

9. **Nested Spans**: Complex workflows create hierarchical traces:
   - Parent spans for high-level operations
   - Child spans for sub-operations
   - Automatic context propagation
   - Full trace visibility across operations

10. **Code Block Tracing**: Use `span()` to trace specific code blocks:
    - Cache operations
    - Data transformations
    - Conditional logic
    - Any code that needs visibility

## Local Development

This example is configured to work in local development without requiring paid Cloudflare features:

- Defaults to local OTLP endpoint (`http://localhost:4318/v1/traces`)
- Uses 100% sampling in development (set `ENVIRONMENT=production` to test production sampling)
- Scheduled handlers work in dev mode
- Queue and Email handlers compile but require paid features to run
- All bindings are optional - code handles missing bindings gracefully

## Advanced Features

### Adaptive Sampling

The example uses adaptive sampling to reduce telemetry costs while capturing critical data:

```typescript
sampling: {
  tailSampler:
    env.ENVIRONMENT === 'production'
      ? SamplingPresets.production() // 10% baseline, all errors, slow >1s
      : SamplingPresets.development(), // 100% in dev
}
```

**Sampling Presets:**
- `SamplingPresets.production()` - 10% baseline, all errors, all slow (>1s)
- `SamplingPresets.highTraffic()` - 1% baseline, all errors, slow >2s
- `SamplingPresets.debugging()` - 50% baseline, all errors, slow >500ms
- `SamplingPresets.development()` - 100% sampling

### Error Handling

Proper error handling with span status codes:

```typescript
const processPayment = trace({
  name: 'payment.process',
  attributesFromArgs: ([amount, userId]) => ({
    'payment.amount': amount,
    'payment.user_id': userId,
  }),
}, (ctx) => async function processPayment(amount: number, userId: string) {
  try {
    // ... processing logic
  } catch (error) {
    ctx.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    ctx.recordException(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
});
```

### Attribute Extractors

Automatically extract attributes from function arguments and results:

```typescript
const getUser = trace({
  name: 'db.getUser',
  attributesFromArgs: ([userId]) => ({ 'user.id': userId }),
  attributesFromResult: (user) => ({ 'user.exists': !!user })
}, async function getUser(userId: string, db: D1Database) {
  // ...
});
```

### Code Block Tracing

Use `span()` to trace specific code blocks:

```typescript
const cached = await span(
  { name: 'cache.check', attributes: { 'cache.key': url.pathname } },
  async (childSpan) => {
    const cached = await caches.default.match(request);
    childSpan.setAttribute('cache.hit', !!cached);
    return cached;
  },
);
```

### Distributed Tracing

Trace context is automatically propagated via HTTP headers:

```typescript
// Trace context automatically propagated
const response = await fetch('https://api.example.com/data', {
  headers: request.headers, // Trace context in headers
});
```

### Nested Spans

Create complex workflows with nested spans:

```typescript
const validateAndCreate = trace({
  name: 'user.create',
  attributesFromArgs: ([data]) => ({ 'user.email': data.email }),
  attributesFromResult: (user) => ({ 'user.id': user.id }),
}, async function validateAndCreate(data, db) {
  const valid = await validateInput(data);      // Child span
  const exists = await checkDuplicate(valid.email, db); // Child span
  if (exists) throw new Error('User already exists');
  return await insertUser(valid, db);          // Child span
});
```

## Running OTLP Collector Locally

Use Docker to run a local OTLP collector:

```bash
docker run -p 4318:4318 -p 4317:4317 \
  -v $(pwd)/otel-collector-config.yaml:/etc/otelcol/config.yaml \
  otel/opentelemetry-collector:latest
```

Or use the simple HTTP receiver:

```bash
docker run -p 4318:4318 \
  -e OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
  otel/opentelemetry-collector:latest \
  --config=/etc/otelcol/config.yaml
```

## Configuration

### Using Alchemy (Current Setup)

This project uses `alchemy.run.ts` for configuration. See `alchemy.run.ts` for the current setup.

### Using Wrangler (Alternative)

If you prefer using `wrangler.toml`, see `wrangler.toml.example` for a complete configuration example.

## Production Deployment Checklist

- [ ] Set `ENVIRONMENT=production` for adaptive sampling
- [ ] Configure `OTLP_ENDPOINT` to your observability platform
- [ ] Set `OTLP_HEADERS` with authentication if required
- [ ] Review sampling rates based on your traffic volume
- [ ] Configure bindings (KV, R2, D1, Service Bindings) as needed
- [ ] Set up scheduled triggers if using cron jobs
- [ ] Configure queue consumers if using Cloudflare Queues
- [ ] Test error handling and verify exceptions are recorded
- [ ] Verify distributed tracing works across services
- [ ] Monitor telemetry costs and adjust sampling if needed

## Actor Example

This example includes a complete [Cloudflare Actors](https://github.com/cloudflare/actors) integration demonstrating how to use `autotel-cloudflare/actors` to get comprehensive tracing of Actor lifecycle methods, storage operations, and alarms.

### Actor Features Demonstrated

- ✅ **Lifecycle Method Tracing** - `onInit`, `onRequest`, `onAlarm` automatically traced
- ✅ **Storage Operations** - SQL queries automatically traced with full query details
- ✅ **Alarm Operations** - Alarm scheduling and execution automatically traced
- ✅ **Persistent Properties** - Property persistence events traced (optional)
- ✅ **Request Routing** - Root spans for Actor requests with actor name extraction
- ✅ **Trace Context Propagation** - Automatic propagation from Worker to Actor

### Actor Endpoints

The Actor example (`src/actor-worker.ts`) provides the following endpoints:

- `GET /?name=<actor-name>` - Get current count for an actor instance
- `POST /increment?name=<actor-name>` - Increment count (with optional `amount` in body)
- `POST /reset?name=<actor-name>` - Reset count to 0
- `GET /storage?name=<actor-name>` - Example SQL storage operations
- `GET /alarms?name=<actor-name>` - Schedule a custom alarm

### Using the Actor Example

#### Option 1: Separate Worker (Recommended)

Create a separate worker for the Actor:

```typescript
// alchemy.run.ts
import { Worker } from 'alchemy/cloudflare';

export const actorWorker = await Worker('counter-actor-worker', {
  entrypoint: './src/actor-worker.ts',
  compatibilityFlags: ['nodejs_compat'],
  durableObjects: {
    bindings: [
      {
        name: 'CounterActor',
        class_name: 'CounterActor',
      },
    ],
  },
  migrations: [
    {
      new_sqlite_classes: ['CounterActor'],
      tag: 'v1',
    },
  ],
});
```

#### Option 2: Integrate into Main Worker

You can also route requests to the Actor from your main worker:

```typescript
// src/worker.ts
import actorHandler from './actor-worker';

const handler: ExportedHandler<Env> = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Route /actor/* requests to the Actor
    if (url.pathname.startsWith('/actor')) {
      return actorHandler.fetch(request, env, ctx);
    }
    
    // ... rest of your handler
  },
};
```

### What Gets Traced

1. **Actor Lifecycle Methods:**
   - `onInit` - Traced with `actor.lifecycle: 'init'` and cold start detection
   - `onRequest` - Traced with full HTTP semantics (`http.method`, `url.path`, etc.)
   - `onAlarm` - Traced with `actor.lifecycle: 'alarm'` and `faas.trigger: 'timer'`

2. **Storage Operations:**
   - All SQL queries via `actor.storage` are automatically traced
   - Query text, parameters, and results are captured
   - Spans include `db.system: 'sqlite'` and `db.operation` attributes

3. **Alarm Operations:**
   - Alarm scheduling via `actor.alarms.set()` is traced
   - Alarm execution is traced with alarm data

4. **Request Routing:**
   - Root span created for each request to the Actor
   - Actor name extracted from request (via `nameFromRequest` static method)
   - Trace context automatically propagated from Worker to Actor

### Example Usage

```bash
# Get count for actor named "counter-1"
curl http://localhost:8787/?name=counter-1

# Increment count by 5
curl -X POST http://localhost:8787/increment?name=counter-1 \
  -H "Content-Type: application/json" \
  -d '{"amount": 5}'

# Reset count
curl -X POST http://localhost:8787/reset?name=counter-1

# Schedule an alarm
curl http://localhost:8787/alarms?name=counter-1
```

### Configuration

The Actor uses the same configuration as the main worker:

```typescript
export default tracedHandler(CounterActor, (env: Env) => ({
  exporter: {
    url: env.OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
  },
  service: {
    name: 'counter-actor-service',
  },
  sampling: {
    tailSampler: SamplingPresets.production(),
  },
  actors: {
    instrumentStorage: true,    // Trace SQL queries
    instrumentAlarms: true,     // Trace alarm operations
    instrumentSockets: true,     // Trace WebSocket operations
    capturePersistEvents: true,  // Trace property persistence
  },
}));
```

### Actor-Specific Attributes

All Actor spans include these semantic attributes:

- `actor.name` - The name/ID of the actor instance
- `actor.class` - The class name of the Actor
- `actor.lifecycle` - The lifecycle event (`init`, `request`, `alarm`, etc.)
- `actor.coldstart` - Whether this is a cold start
- `actor.identifier` - The actor identifier (if available)

### See Also

- [Cloudflare Actors Documentation](https://github.com/cloudflare/actors)
- [autotel-cloudflare Actors Integration](../../packages/autotel-cloudflare/src/actors/README.md)

## Agent Example

This example includes a complete [Cloudflare Agents SDK](https://github.com/cloudflare/agents) integration demonstrating how to use `autotel-cloudflare/agents` to get comprehensive tracing of Agent RPC calls, scheduled tasks, MCP operations, and lifecycle events.

### Agent Features Demonstrated

- ✅ **RPC Method Tracing** - All `@callable()` methods automatically traced
- ✅ **Scheduled Task Tracing** - Schedule creation, execution, and cancellation traced
- ✅ **MCP Operations** - Model Context Protocol operations automatically traced
- ✅ **Lifecycle Events** - Connect and destroy events traced
- ✅ **Message Events** - Message request/response/clear events traced
- ✅ **Error Handling** - Errors in RPC methods automatically captured

### Agent RPC Methods

The Agent example (`src/agent.ts`) provides the following RPC methods:

- `processTask(taskName: string, priority?: number)` - Process a task with priority
- `processTaskWithError(taskName: string)` - Example with error handling
- `scheduledCleanup()` - Scheduled task example
- `callMcpServer(serverId: string, method: string, params?: object)` - MCP operation example
- `sendMessage(recipient: string, message: string)` - Message sending example
- `getStats()` - Get agent statistics

### Using the Agent Example

#### Option 1: Separate Worker (Recommended)

Create a separate worker for the Agent:

```typescript
// alchemy.run.ts
import { Worker, DurableObjectNamespace } from 'alchemy/cloudflare';

const taskAgentNamespace = DurableObjectNamespace('task-agent', {
  className: 'TaskAgent',
});

export const agentWorker = await Worker('task-agent-worker', {
  entrypoint: './src/agent-worker.ts',
  compatibilityFlags: ['nodejs_compat'],
  bindings: {
    TaskAgent: taskAgentNamespace,
  },
});
```

#### Option 2: Integrate into Main Worker

You can also route requests to the Agent from your main worker using the Agents SDK routing.

### What Gets Traced

1. **RPC Calls:**
   - All methods decorated with `@callable()` are automatically traced
   - Span name: `agent.rpc {method}`
   - Attributes include `agent.rpc.method` and `agent.rpc.streaming` (if applicable)
   - Errors are automatically captured with proper span status

2. **Scheduled Tasks:**
   - Schedule creation: `agent.schedule.create {callback}`
   - Schedule execution: `agent.schedule.execute {callback}`
   - Schedule cancellation: `agent.schedule.cancel {callback}`
   - Attributes include `agent.schedule.callback` and `agent.schedule.id`

3. **MCP Operations:**
   - Preconnect: `mcp.preconnect {serverId}`
   - Connect: `mcp.connect {url}`
   - Authorize: `mcp.authorize {serverId}`
   - Discover: `mcp.discover`
   - Attributes include MCP-specific details (URL, transport, state, etc.)

4. **Lifecycle Events:**
   - Connect: `agent.connect` with `agent.connection.id`
   - Destroy: `agent.destroy`

5. **Message Events:**
   - Request: `agent.message.request`
   - Response: `agent.message.response`
   - Clear: `agent.message.clear`

### Configuration

The Agent uses OpenTelemetry observability configured in the constructor:

```typescript
class TaskAgent extends Agent<Env> {
  observability;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    
    this.observability = createOtelObservability({
      exporter: {
        url: env.OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
      },
      service: {
        name: 'task-agent-service',
      },
      sampling: {
        tailSampler: SamplingPresets.production(),
      },
      agents: {
        traceRpc: true,           // Trace RPC calls (default: true)
        traceSchedule: true,      // Trace scheduled tasks (default: true)
        traceMcp: true,           // Trace MCP operations (default: true)
        traceStateUpdates: false, // Skip state updates (default: false)
        traceMessages: true,      // Trace message events (default: true)
        traceLifecycle: true,     // Trace connect/destroy (default: true)
      },
    });
  }
}
```

### Environment-Based Configuration

You can also use environment variables for configuration:

```typescript
import { createOtelObservabilityFromEnv } from 'autotel-cloudflare/agents';

class TaskAgent extends Agent<Env> {
  observability;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    // Automatically reads OTEL_* environment variables
    this.observability = createOtelObservabilityFromEnv(env);
  }
}
```

Environment variables:
- `OTEL_EXPORTER_OTLP_ENDPOINT` - OTLP exporter URL
- `OTEL_EXPORTER_OTLP_HEADERS` - Headers as comma-separated key=value pairs
- `OTEL_SERVICE_NAME` - Service name (defaults to 'cloudflare-agent')

### Agent-Specific Attributes

All Agent spans include these semantic attributes:

- `agent.event.type` - The event type (rpc, schedule:create, mcp:client:connect, etc.)
- `agent.event.id` - Unique event identifier
- `agent.rpc.method` - RPC method name (for RPC events)
- `agent.rpc.streaming` - Whether the RPC is streaming (for RPC events)
- `agent.schedule.callback` - Scheduled callback name (for schedule events)
- `agent.schedule.id` - Schedule ID (for schedule events)
- `agent.connection.id` - Connection ID (for connect events)
- `agent.mcp.*` - MCP-specific attributes (server_id, url, transport, state, etc.)

### Example Usage

The Agents SDK handles RPC routing automatically. You interact with agents via RPC calls:

```typescript
// From another worker or client
const agent = env.TaskAgent.get(id);
const result = await agent.processTask('important-task', 5);
```

### See Also

- [Cloudflare Agents SDK Documentation](https://github.com/cloudflare/agents)
- [autotel-cloudflare Agents Integration](../../packages/autotel-cloudflare/src/agents/README.md)

## Comparison with Other Examples

This example is more comprehensive than basic OpenTelemetry examples because it includes:

1. **Adaptive Sampling** - Production-ready cost optimization
2. **Error Handling** - Proper span status codes and exception recording
3. **Attribute Extractors** - Automatic attribute extraction
4. **Nested Spans** - Complex workflow tracing
5. **Code Block Tracing** - Fine-grained visibility
6. **Distributed Tracing** - Automatic context propagation
7. **Multiple Handler Types** - Fetch, Scheduled, Queue, Email
8. **Auto-instrumentation** - KV, R2, D1, Service Bindings, Fetch, Cache
9. **Edge Adapters** - Events event tracking
10. **Production Best Practices** - Environment-based configuration, proper error handling
