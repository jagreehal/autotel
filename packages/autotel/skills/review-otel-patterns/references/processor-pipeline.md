# Processor pipeline cookbook

Composable building blocks for the autotel pipeline. Each helper is small enough to reason about in isolation and isolates errors so a single bad processor cannot break the others.

## Primitives

| Helper                       | Type              | Purpose                                                      |
| ---------------------------- | ----------------- | ------------------------------------------------------------ |
| `defineConfig(config)`       | identity          | Authoring helper for typed config                            |
| `composeSpanProcessors([…])` | `SpanProcessor`   | Fan span lifecycle to multiple processors                    |
| `composePostProcessors([…])` | `PostProcessorFn` | Chain post-processors (each sees the output of the previous) |
| `composeSubscribers([…])`    | `EdgeSubscriber`  | Fire in-process side effects in order                        |

All from `autotel-edge`.

## Multi-backend export

```typescript
import { BatchSpanProcessor } from 'autotel/processors';
import { OTLPHttpJsonExporter } from 'autotel/exporters';
import { composeSpanProcessors, defineConfig } from 'autotel-edge';

const honeycomb = new BatchSpanProcessor(
  new OTLPHttpJsonExporter({
    url: 'https://api.honeycomb.io/v1/traces',
    headers: { 'x-honeycomb-team': process.env.HONEYCOMB_KEY! },
  }),
);

const grafana = new BatchSpanProcessor(
  new OTLPHttpJsonExporter({
    url: process.env.GRAFANA_OTLP_URL!,
    headers: { authorization: `Basic ${process.env.GRAFANA_AUTH!}` },
  }),
);

export const config = defineConfig({
  service: { name: 'checkout' },
  spanProcessors: composeSpanProcessors([honeycomb, grafana]),
});
```

## Tail sampling: keep errors + slow + 10% otherwise

```typescript
import { TailSamplingProcessor } from 'autotel/processors';
import { composeSpanProcessors } from 'autotel-edge';

const tail = new TailSamplingProcessor({
  keep: (trace) => {
    if (trace.localRootSpan.status?.code === SpanStatusCode.ERROR) return true;
    if (trace.localRootSpan.duration[0] > 1) return true; // > 1s
    return Math.random() < 0.1;
  },
});

spanProcessors: composeSpanProcessors([new BatchSpanProcessor(otlp), tail]);
```

## Drop noisy spans before they reach the batcher

```typescript
import { FilteringSpanProcessor } from 'autotel/processors';

const dropHealth = new FilteringSpanProcessor({
  exclude: (span) => /^GET \/(healthz|ready)$/.test(span.name),
});

spanProcessors: composeSpanProcessors([
  dropHealth,
  new BatchSpanProcessor(otlp),
]);
```

## Bound URL cardinality

```typescript
import { SpanNameNormalizingProcessor } from 'autotel/processors';

const normalise = new SpanNameNormalizingProcessor({
  // Replace UUIDs and 24-char hex ids with placeholders
  replacements: [
    {
      match: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
      with: ':id',
    },
    { match: /[0-9a-f]{24}/g, with: ':id' },
  ],
});
```

Now `GET /users/123e4567-e89b-12d3-a456-426614174000/orders` becomes `GET /users/:id/orders` in your traces — fewer unique span names, dramatically faster queries.

## Lift baggage onto every span

```typescript
import { BaggageSpanProcessor } from 'autotel/processors';

// Anything placed in baggage upstream becomes an attribute on every child span
const baggage = new BaggageSpanProcessor({ keys: ['tenant', 'feature_flags'] });
spanProcessors: composeSpanProcessors([baggage, new BatchSpanProcessor(otlp)]);
```

## Subscribers for in-process side effects

Subscribers run synchronously in the parent context — ideal for metrics, audit, and cost calculation that you want recorded **before** the span goes to the batcher.

```typescript
import type { EdgeSubscriber } from 'autotel-edge';
import { composeSubscribers } from 'autotel-edge';

const metricsSubscriber: EdgeSubscriber = (event) => {
  if (
    event.kind === 'span.end' &&
    event.span.attributes['http.response.status_code'] >= 500
  ) {
    metrics.errorCounter.add(1, { route: event.span.name });
  }
};

const auditSubscriber: EdgeSubscriber = (event) => {
  if (event.kind === 'span.end' && event.span.name.startsWith('admin.')) {
    audit.write({
      kind: event.span.name,
      actor: event.span.attributes['user.id'],
    });
  }
};

subscribers: [composeSubscribers([metricsSubscriber, auditSubscriber])];
```

## Post-processors for last-mile rewrites

Post-processors mutate the array of spans **after** sampling, just before export. Use for redacting stack traces, dropping fields, or annotating with deployment info.

```typescript
import type { PostProcessorFn } from 'autotel-edge';
import { composePostProcessors } from 'autotel-edge';
import { createStringRedactor } from 'autotel';

const redactStacks = createStringRedactor('strict');

const cleanStacks: PostProcessorFn = (spans) =>
  spans.map((s) => {
    if (typeof s.attributes['exception.stacktrace'] === 'string') {
      s.attributes['exception.stacktrace'] = redactStacks(
        s.attributes['exception.stacktrace'],
      );
    }
    return s;
  });

const tagDeploy: PostProcessorFn = (spans) =>
  spans.map((s) => ({
    ...s,
    attributes: { ...s.attributes, 'deploy.id': process.env.RELEASE! },
  }));

postProcessor: composePostProcessors([cleanStacks, tagDeploy]);
```

## Putting it all together

```typescript
import {
  defineConfig,
  composeSpanProcessors,
  composeSubscribers,
  composePostProcessors,
} from 'autotel-edge';

export const otelConfig = defineConfig({
  service: { name: 'checkout' },
  attributeRedactor: 'strict',

  spanProcessors: composeSpanProcessors([
    dropHealth, // 1. drop spans we never want
    normaliseUrls, // 2. bound cardinality
    new BatchSpanProcessor(honeycomb),
    new BatchSpanProcessor(grafana),
    tailSampler, // 3. keep errors + slow + 10%
  ]),

  subscribers: [
    composeSubscribers([metricsSubscriber, auditSubscriber, aiCostSubscriber]),
  ],

  postProcessor: composePostProcessors([cleanStacks, tagDeploy]),
});
```

## Error isolation

Every compose helper catches errors per item and logs to `console.error` with the helper name. A single bad processor cannot break the others — important when one of your subscribers is a third-party integration (Datadog, PagerDuty, …) that can rate-limit or 502.

## Choosing between subscribers and post-processors

| You want…                                 | Use                                                        |
| ----------------------------------------- | ---------------------------------------------------------- |
| Mutate exported span attributes           | `postProcessor`                                            |
| Drop spans entirely                       | `FilteringSpanProcessor` (early) or tail sampler           |
| Update an in-process metric on every span | `subscribers`                                              |
| Send an audit log to a DB                 | `subscribers` (use `log.fork('audit')` if writes are slow) |
| Re-emit spans to a second backend         | second `BatchSpanProcessor` in `composeSpanProcessors`     |
