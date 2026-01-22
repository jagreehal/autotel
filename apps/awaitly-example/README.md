# Awaitly + Autotel Kitchen Sink Example

A comprehensive, production-ready example demonstrating the full integration between awaitly workflows and autotel OpenTelemetry instrumentation. This example shows both successful workflows and error handling scenarios with complete observability.

## Features Demonstrated

- ✅ **Successful Workflows**: Complete checkout flow with visualization
- ⚠️ **Error Handling**: Multiple error scenarios with proper tracking
- 🎯 **Decision Tracking**: Conditional logic with branching visualization
- 🔄 **Cache Behavior**: Step caching with hit/miss tracking
- 📊 **OpenTelemetry Integration**: Full span and metrics collection
- 📈 **Visualization**: ASCII and Mermaid diagram generation
- 🎨 **Console Logging**: Pretty colored console output
- 🔍 **Autotel Tracing**: Workflow-level trace spans

## Quick Start

```bash
npm start
```

Or with pnpm:

```bash
pnpm --filter @jagreehal/awaitly-example start
```

## What's Included

### Example 1: Successful Workflow ✅

Demonstrates a complete successful checkout workflow with:
- Step-level spans
- Metrics collection
- ASCII visualization
- Mermaid diagrams
- Console logging

**Output includes:**
- Success metrics (all steps succeeded)
- Beautiful ASCII box diagrams
- Mermaid flowcharts ready for GitHub markdown
- Console logger output with colored events

### Example 2: Error Handling ⚠️

Shows how errors are tracked and visualized:
- Error spans with proper status codes
- Error metrics collection
- Error visualization (red indicators)
- Error type tracking

**Output shows:**
- Error metrics with `success: false`
- Visualizations with ✗ indicators
- Proper error Result types

### Example 3: Decision Tracking 🎯

Demonstrates conditional logic tracking:
- `trackIf` for if/else branches
- Decision visualization in diagrams
- Branch-specific metrics

**Features:**
- Tracks which branch was taken
- Visualizes decision points in diagrams
- Records branch-specific step execution

### Example 4: Cache Behavior 🔄

Shows step caching in action:
- Cache hit/miss tracking
- Cache-aware metrics
- Console logging of cache events

**Demonstrates:**
- First call: cache miss
- Second call with same key: cache hit
- Cache statistics in metrics

### Example 5: With Autotel Tracing 🎯

Wraps entire workflow in OpenTelemetry trace:
- Parent span for entire workflow
- Step spans as children
- Custom attributes

**Production pattern:**
- Use `withAutotelTracing` to wrap workflows
- Add custom attributes for filtering
- Full trace context propagation

### Example 6: Multiple Error Scenarios 🔴

Comprehensive error testing:
- User not found errors
- Card declined errors
- Email failure errors
- All tracked in metrics

**Shows:**
- Different error types
- Error aggregation
- Complete error visualization

## Architecture

### Business Logic Pattern

The example uses **Result types** for proper error handling:

```typescript
type UserNotFound = { type: 'USER_NOT_FOUND'; userId: string };
type CardDeclined = { type: 'CARD_DECLINED'; amount: number; reason: string };

const fetchUser = async (id: string): Promise<AsyncResult<User, UserNotFound>> => {
  if (id === 'error-user') {
    return err({ type: 'USER_NOT_FOUND', userId: id });
  }
  return ok({ id, name: `User ${id}`, email: `user${id}@example.com` });
};
```

### Workflow Setup

```typescript
import { createWorkflow } from 'awaitly/workflow';
import { createAutotelAdapter } from 'awaitly/otel';
import { createVisualizer } from 'awaitly/visualize';
import { createConsoleLogger } from 'awaitly/devtools';

const deps = {
  fetchUser,
  chargeCard,
  sendEmail,
};

const autotel = createAutotelAdapter({
  serviceName: 'checkout-service',
  createStepSpans: true,
  recordMetrics: true,
});

const viz = createVisualizer({
  workflowName: 'checkout',
  showDurations: true,
});

const logger = createConsoleLogger({
  prefix: '[checkout]',
  colors: true,
});

const workflow = createWorkflow(deps, {
  onEvent: (event) => {
    autotel.handleEvent(event);
    viz.handleEvent(event);
    logger(event);
  },
});
```

### Workflow Execution

```typescript
const result = await workflow(async (step, deps) => {
  const user = await step(() => deps.fetchUser('user-123'), {
    name: 'Fetch user',
  });

  const charge = await step(() => deps.chargeCard(99.99), {
    name: 'Charge card',
  });

  const email = await step(
    () => deps.sendEmail(user.email, 'Order confirmation'),
    { name: 'Send email' }
  );

  return { user, charge, email };
});

if (result.ok) {
  console.log('Success:', result.value);
} else {
  console.error('Error:', result.error);
}
```

## Output Examples

### Successful Workflow Output

```
[checkout] ⏵ Workflow started
[checkout] → Fetch user
[checkout] ✓ Fetch user (51ms)
[checkout] → Charge card
[checkout] ✓ Charge card (101ms)
[checkout] → Send email
[checkout] ✓ Send email (31ms)
[checkout] ✓ Workflow completed (186ms)

📊 ASCII Visualization:
┌── successful-checkout ───────────────────────────────────────────────┐
│                                                                      │
│  ✓ Fetch user [51ms]                                                 │
│  ✓ Charge card [101ms]                                               │
│  ✓ Send email [31ms]                                                 │
│                                                                      │
│  Completed in 186ms                                                  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘

📊 Mermaid Visualization:
flowchart TD
    start(("▶ Start"))
    step_1[✓ Fetch user 51ms]:::success
    start --> step_1
    step_2[✓ Charge card 101ms]:::success
    step_1 --> step_2
    step_3[✓ Send email 31ms]:::success
    step_2 --> step_3
    finish(("✓ Done")):::success
    step_3 --> finish
```

### Error Handling Output

```
❌ Expected error (user not found)
error: {
  "type": "USER_NOT_FOUND",
  "userId": "error-user"
}

📊 Error metrics
{
  "stepDurations": [
    {
      "name": "error-service.Fetch user (will fail)",
      "durationMs": 51.47,
      "success": false
    }
  ],
  "errorCount": 2,
  "retryCount": 0
}

📊 Visualization (shows error):
┌── error-handling-demo ───────────────────────────────────────────────┐
│                                                                      │
│  ✗ Fetch user (will fail) [51ms]                                    │
│                                                                      │
│  Failed in 52ms                                                      │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## Metrics

Access collected metrics:

```typescript
const metrics = autotel.getMetrics();

console.log(metrics.stepDurations);
// [
//   {
//     name: 'checkout-service.Fetch user',
//     durationMs: 51.47,
//     success: true,
//     attributes: { environment: 'development', workflow: 'checkout' }
//   },
//   ...
// ]

console.log(metrics.retryCount);     // Total retry count
console.log(metrics.errorCount);     // Total error count
console.log(metrics.cacheHits);      // Cache hit count
console.log(metrics.cacheMisses);    // Cache miss count
console.log(metrics.defaultAttributes); // Default attributes
```

## Visualization

### ASCII Diagrams

Beautiful box-drawing diagrams showing workflow execution with step status and durations.

### Mermaid Diagrams

Flowchart diagrams that can be pasted into GitHub markdown or Mermaid-compatible renderers. Perfect for documentation and dashboards.

### Console Logger

Pretty colored console output with workflow events:

```
[checkout] ⏵ Workflow started
[checkout] → Fetch user
[checkout] ✓ Fetch user (51ms)
[checkout] ✓ Workflow completed (186ms)
```

## Decision Tracking

Track conditional logic for visualization:

```typescript
import { trackIf } from 'awaitly/visualize';

const decision = trackIf('check-premium', user.isPremium, {
  condition: 'user.isPremium',
  emit: viz.handleDecisionEvent,
});

if (decision.condition) {
  decision.then();
  data = await step(() => deps.fetchPremiumData(user.id));
} else {
  decision.else();
  data = await step(() => deps.fetchBasicData(user.id));
}
decision.end();
```

## Configuration

The example uses `autotel init` with `debug: true`:

```typescript
import { init } from 'autotel';

init({
  service: 'awaitly-example',
  debug: true,
  endpoint: process.env.OTLP_ENDPOINT || 'http://localhost:4318',
});
```

## Production Setup

### Using with Production Backends

Replace the default endpoint with your OTLP-compatible backend:

```typescript
// Honeycomb
init({
  service: 'awaitly-example',
  endpoint: 'https://api.honeycomb.io',
  headers: { 'x-honeycomb-team': process.env.HONEYCOMB_API_KEY },
});

// Datadog
init({
  service: 'awaitly-example',
  endpoint: 'https://http-intake.logs.datadoghq.com',
  headers: { 'DD-API-KEY': process.env.DD_API_KEY },
});

// Grafana Cloud
init({
  service: 'awaitly-example',
  endpoint: 'https://otlp-gateway-prod-us-central-0.grafana.net/otlp',
  headers: {
    Authorization: `Basic ${Buffer.from(`${process.env.GRAFANA_INSTANCE_ID}:${process.env.GRAFANA_API_KEY}`).toString('base64')}`,
  },
});
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `OTLP_ENDPOINT` | OTLP exporter endpoint (default: `http://localhost:4318`) |
| `AUTOTEL_DEBUG` | Set to `true` for console output |
| `OTEL_SERVICE_NAME` | Default service name (overridden by config) |

## TypeScript

The example passes TypeScript compilation with strict type checking:

```bash
npx tsc --noEmit
```

All types are properly inferred from the awaitly workflow system.

## Key Patterns

### 1. Result Types for Error Handling

Always use Result types for business logic functions:

```typescript
type MyError = { type: 'MY_ERROR'; reason: string };

const myFunction = async (): Promise<AsyncResult<Data, MyError>> => {
  if (shouldFail) {
    return err({ type: 'MY_ERROR', reason: 'Something went wrong' });
  }
  return ok({ data: 'success' });
};
```

### 2. Combining Event Handlers

Combine multiple event handlers for comprehensive observability:

```typescript
const workflow = createWorkflow(deps, {
  onEvent: (event) => {
    autotel.handleEvent(event);  // OpenTelemetry
    viz.handleEvent(event);      // Visualization
    logger(event);               // Console logging
    customHandler(event);        // Custom logic
  },
});
```

### 3. Workflow with Tracing

Wrap workflows in trace spans for distributed tracing:

```typescript
const traced = withAutotelTracing(trace, {
  serviceName: 'checkout-service',
});

const result = await traced('process-order', async () => {
  return workflow(async (step, deps) => {
    // ... workflow steps
  });
}, { orderId: '123' });
```

### 4. Error Result Handling

Always check `result.ok` before accessing values:

```typescript
const result = await workflow(async (step, deps) => {
  // ... steps
});

if (result.ok) {
  // Success path
  console.log('Success:', result.value);
} else {
  // Error path
  console.error('Error:', result.error);
}
```

## Span Attributes

When `createStepSpans` is enabled, spans include:

| Attribute | Description |
|-----------|-------------|
| `workflow.step.name` | Step name from options |
| `workflow.step.key` | Step cache key (if set) |
| `workflow.step.cached` | Whether result was cached |
| `workflow.step.retry_count` | Number of retries |
| `workflow.step.duration_ms` | Step duration |
| `workflow.step.success` | Whether step succeeded |
| `workflow.step.error` | Error type (if failed) |

## References

- [Awaitly OpenTelemetry Docs](https://awaitly.dev/docs/advanced/opentelemetry)
- [Awaitly Visualization Docs](https://awaitly.dev/docs/guides/visualization)
- [Autotel Documentation](../../packages/autotel/README.md)

## License

Part of the autotel monorepo.
