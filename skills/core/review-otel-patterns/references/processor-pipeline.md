# Processor pipeline cookbook

Composable building blocks for the autotel pipeline. Node and edge runtimes
build the pipeline differently: in Node, `init()` options cover almost every
case; on edge, you compose processors, post-processors and subscribers into the
`wrapModule` / `defineWorkerFetch` config.

## Node: prefer `init()` options

Each option wraps the built-in processors for you, in the right order (filter
sees original attributes, redaction runs last before export):

| You want…                           | `init()` option                                                   |
| ----------------------------------- | ----------------------------------------------------------------- |
| Several OTLP backends               | `destinations: [{ endpoint, headers, signals? }, …]`              |
| Keep errors + slow + a sampled %    | `sampling: 'production'`, set explicitly (unset keeps all)        |
| Drop health checks / noise          | `spanFilter: (span) => boolean` (return `false` to drop)          |
| Bound URL cardinality               | `spanNameNormalizer: 'rest-api' \| 'graphql' \| 'minimal' \| fn`  |
| Lift baggage onto every span        | `baggage: true` (→ `baggage.*`) or a prefix string                |
| Mask PII                            | `attributeRedactor: 'default' \| 'strict' \| 'pci-dss' \| config` |
| Hierarchical console output locally | `debug: 'pretty'`                                                 |

```typescript
import { init } from 'autotel';

init({
  service: 'checkout',
  destinations: [
    {
      endpoint: 'https://api.honeycomb.io',
      headers: { 'x-honeycomb-team': process.env.HONEYCOMB_KEY! },
    },
    {
      endpoint: process.env.GRAFANA_OTLP_URL!, // https://otlp-gateway-<region>.grafana.net/otlp
      headers: { authorization: `Basic ${process.env.GRAFANA_AUTH!}` },
      signals: ['traces'],
    },
  ],
  spanFilter: (span) => !/^GET \/(healthz|ready)$/.test(span.name),
  spanNameNormalizer: 'rest-api', // GET /users/123 → GET /users/:id
  baggage: true,
  attributeRedactor: 'strict',
});
```

Tune the sampler with `sampler: samplingPresets.production({ baselineSampleRate: 0.05 })` (`samplingPresets` from `autotel`).

### Manual processors (Node)

Only when you pass your own `spanProcessors` (which replaces the built-in OTLP
processors). The wrappers come from `autotel`; `SimpleSpanProcessor` /
`BatchSpanProcessor` from `autotel/processors`:

| Processor                      | Constructor                                                   |
| ------------------------------ | ------------------------------------------------------------- |
| `FilteringSpanProcessor`       | `new FilteringSpanProcessor(wrapped, { filter })`             |
| `SpanNameNormalizingProcessor` | `new SpanNameNormalizingProcessor(wrapped, { normalizer })`   |
| `AttributeRedactingProcessor`  | `new AttributeRedactingProcessor(wrapped, { redactor })`      |
| `BaggageSpanProcessor`         | `new BaggageSpanProcessor({ prefix })` (default `'baggage.'`) |
| `PrettyConsoleExporter`        | exporter, from `autotel/exporters`                            |

```typescript
import { init, FilteringSpanProcessor } from 'autotel';
import { BatchSpanProcessor } from 'autotel/processors';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

init({
  service: 'checkout',
  spanProcessors: [
    new FilteringSpanProcessor(
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: 'http://localhost:4318/v1/traces' }),
      ),
      { filter: (span) => !span.name.includes('/health') },
    ),
  ],
});
```

## Edge: composition primitives

All from `autotel-edge` (re-exported by `autotel-cloudflare`):

| Helper                       | Type              | Purpose                                                      |
| ---------------------------- | ----------------- | ------------------------------------------------------------ |
| `defineConfig(config)`       | identity          | Authoring helper for typed config                            |
| `composeSpanProcessors([…])` | `SpanProcessor`   | Fan span lifecycle to multiple processors                    |
| `composePostProcessors([…])` | `PostProcessorFn` | Chain post-processors (each sees the output of the previous) |
| `composeSubscribers([…])`    | `EdgeSubscriber`  | Fire in-process side effects in order                        |

`postProcessor` and `sampling.tailSampler` run inside the built-in processor
that `exporter` creates. If you pass `spanProcessors` instead, they are not applied.

## Edge: tail sampling (errors + slow + 10% otherwise)

```typescript
import { defineConfig } from 'autotel-edge';
import {
  combineTailSamplers,
  createErrorOnlyTailSampler,
  createSlowOnlyTailSampler,
  createRandomTailSampler,
} from 'autotel-edge/sampling';

export const config = defineConfig({
  service: { name: 'checkout' },
  exporter: {
    url: 'https://api.honeycomb.io/v1/traces',
    headers: { 'x-honeycomb-team': '<key>' },
  },
  sampling: {
    tailSampler: combineTailSamplers(
      createErrorOnlyTailSampler(),
      createSlowOnlyTailSampler(1000), // ms
      createRandomTailSampler(0.1),
    ),
  },
});
```

## Edge: multi-backend export

```typescript
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import {
  OTLPExporter,
  composeSpanProcessors,
  defineConfig,
} from 'autotel-edge';

const honeycomb = new BatchSpanProcessor(
  new OTLPExporter({
    url: 'https://api.honeycomb.io/v1/traces', // edge exporter URLs are used as-is
    headers: { 'x-honeycomb-team': process.env.HONEYCOMB_KEY! },
  }),
);
const grafana = new BatchSpanProcessor(
  new OTLPExporter({
    url: `${process.env.GRAFANA_OTLP_URL!}/v1/traces`,
    headers: { authorization: `Basic ${process.env.GRAFANA_AUTH!}` },
  }),
);

export const config = defineConfig({
  service: { name: 'checkout' },
  spanProcessors: composeSpanProcessors([honeycomb, grafana]),
});
```

## Edge: subscribers for in-process side effects

Subscribers receive the events you emit with `getEdgeSubscribers(ctx)` from
`autotel-edge/events` (`trackEvent`, `trackOutcome`, `trackFunnelStep`,
`trackValue`). They are not span hooks.

```typescript
import { composeSubscribers, type EdgeSubscriber } from 'autotel-edge';

const metricsSubscriber: EdgeSubscriber = (event) => {
  if (event.type === 'outcome' && event.outcome === 'failure') {
    metrics.errorCounter.add(1, { operation: event.operation });
  }
};

const auditSubscriber: EdgeSubscriber = async (event) => {
  if (event.type === 'event' && event.event.startsWith('admin.')) {
    await audit.write({ kind: event.event, actor: event.attributes['user.id'] });
  }
};

// in the config:
subscribers: [composeSubscribers([metricsSubscriber, auditSubscriber])],
```

## Edge: post-processors for last-mile rewrites

Post-processors take the finished spans of a trace and return the spans to
export. Use for redacting stack traces, dropping spans, or annotating with
deployment info.

```typescript
import { composePostProcessors, type PostProcessorFn } from 'autotel-edge';
import { createStringRedactor } from 'autotel';

const redactStacks = createStringRedactor('strict');

const cleanStacks: PostProcessorFn = (spans) => {
  for (const s of spans) {
    const stack = s.attributes['exception.stacktrace'];
    if (typeof stack === 'string') s.attributes['exception.stacktrace'] = redactStacks(stack);
  }
  return spans;
};

const tagDeploy: PostProcessorFn = (spans) => {
  for (const s of spans) s.attributes['deploy.id'] = RELEASE_ID;
  return spans;
};

// in the config (requires `exporter`, not `spanProcessors`):
postProcessor: composePostProcessors([cleanStacks, tagDeploy]),
```

## Error isolation

Every edge compose helper catches errors per item and logs to `console.error` with the helper name. A single bad processor cannot break the others. Important when one of your subscribers is a third-party integration (Datadog, PagerDuty, …) that can rate-limit or 502.

## Choosing the tool

| You want…                           | Node                                 | Edge                                        |
| ----------------------------------- | ------------------------------------ | ------------------------------------------- |
| Mutate exported span attributes     | `attributeRedactor` / span enrichers | `postProcessor`                             |
| Drop spans entirely                 | `spanFilter`                         | `postProcessor` or `sampling.tailSampler`   |
| React to business events in-process | `subscribers` (with `track()`)       | `subscribers` (with `getEdgeSubscribers`)   |
| Re-emit spans to a second backend   | `destinations`                       | second processor in `composeSpanProcessors` |
