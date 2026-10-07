# Incident readiness

`autotel map` scores whether each entry point is traced. That is necessary and
not sufficient: a fully traced service can still page nobody when one
dependency, queue or rollout goes bad. Load this when the user asks about
faster detection, "would we have caught this", alerting, or when a repo owns
dependency calls, queues, background jobs, derived data or rollouts.

The telemetry has to answer, without a manual trace search:

- Is the whole app down, or one workflow degraded?
- Which workflow, dependency, queue, region or release is involved?
- Is the symptom latency, errors, stale data, backlog, auth/edge, capacity, or a release?

## Signals by area

| Area            | Emit                                                                                                   | Partition by                        |
| --------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| Workflow        | duration, outcome, error class                                                                         | workflow name, environment          |
| Dependency      | outcome, duration, timeout, retry, rate limit / throttle, circuit-breaker state                        | dependency, operation, reason       |
| Backpressure    | queue depth, consumer lag, oldest message age, retry and dead-letter rate                              | queue / destination, consumer group |
| Freshness       | newest-event age, ingest and processing lag, accepted / dropped count with drop reason                 | pipeline, source                    |
| Input size      | payload size bucket, item count bucket, parse / validation failure                                     | workflow                            |
| Auth and edge   | login / token / identity-provider outcome, certificate or secret expiry age                            | provider, reason                    |
| Capacity        | in-flight work, pool size vs max, rejected / shed work, restarts                                       | pool, workflow                      |
| Release context | `service.version`, `deployment.environment.name`, `cloud.region`, feature flag, rollout / canary batch | resource attributes and span attrs  |

Never partition a metric by user, tenant, request, session, trace id, raw URL
or payload. Those go on spans and the request logger (skill
`design-alertable-metrics`).

## With autotel

**Dependency outcome, with the reason.** Partitioning by reason lets one
failing upstream show up on its own, apart from the blended error rate:

```typescript
import { Metric } from 'autotel';

const deps = new Metric('checkout', {
  metrics: { outcomes: { name: 'dependency.requests' } },
});

deps.trackOutcome('payments.charge', 'failure', {
  dependency: 'stripe',
  reason: 'timeout', // timeout | rate_limit | 5xx | auth | circuit_open
});
```

**Queues.** `traceConsumer` links producer and consumer spans and records
retries and dead letters; `lagMetrics` puts consumer lag on the span:

```typescript
import { traceConsumer } from 'autotel/messaging';

export const handle = traceConsumer({
  system: 'sqs',
  destination: 'orders-queue',
  onDLQ: (ctx, reason) => ctx.recordDLQ(reason, 'orders-dlq'),
})((ctx) => async (message: SQSMessage) => {
  ctx.recordRetry(Number(message.Attributes?.ApproximateReceiveCount), 3);
  await processOrder(JSON.parse(message.Body));
});
```

A span attribute is not an alert source. For depth and oldest-message age,
read them where the service can observe them accurately:

```typescript
import { createObservableGauge } from 'autotel';

createObservableGauge('queue.oldest_message_age', { unit: 's' }).addCallback(
  async (result) => {
    result.observe(await queue.oldestAgeSeconds(), { queue: 'orders' });
  },
);
```

**Freshness.** A bare "seconds since last update" gauge also grows when the
system is healthy and idle. Alert on it only when the source proves an
expected cadence or pending work; otherwise alert on backlog or a missed
schedule, and keep the age as context.

**Release context.** `init()` sets `service.version` (detected from
`package.json` when not given) and `deployment.environment.name`. Add the rest
as resource attributes, and record the flag the request actually branched on:

```typescript
import { init } from 'autotel';
import { recordFeatureFlag } from 'autotel/feature-flags';

init({
  service: 'checkout',
  version: process.env.GIT_SHA,
  environment: process.env.DEPLOY_ENV,
  resourceAttributes: {
    'cloud.region': process.env.AWS_REGION,
    'deployment.rollout.batch': process.env.ROLLOUT_BATCH,
  },
});

recordFeatureFlag(ctx, {
  key: 'new-checkout',
  value: enabled,
  provider: 'flags-service',
});
```

Do not emit legacy spellings (`deployment.environment`, `container.image.tag`)
beside the canonical names in new code.

## Rules

- Emit only what the service can observe accurately. No placeholder instruments
  for signals it cannot see.
- Prefer semantic-convention names (HTTP, RPC, database, messaging, runtime);
  a custom metric only where none fits.
- Traces only? Add metrics for what should page: workflow latency and errors,
  dependency failure, queue lag, freshness, saturation.
- Metrics only? Add span attributes or request-logger fields that localize:
  workflow, dependency, error class, release, region.
- A web process and its workers get distinct `service.name`s, and each calls
  `init()` from its own entrypoint, not from a shared module both import.
- Instrument both sides of an enqueue / consume boundary, and record failure on
  the worker side before rethrowing.
- Prove a detector-critical signal by driving it to a non-zero value in a test
  (a full queue, a timed-out dependency) and asserting the datapoint. A metric
  that only ever reported its default proves registration, not readiness.

## When incidents are supplied

Given a postmortem, alert or ticket, build the matrix before editing:

```text
incident -> failure mechanism -> owning code -> signal -> detects or localizes -> remaining owner
```

Target the mechanism, not the symptom: a 5xx rate does not catch an expired
secret, a stale output or a stalled rollout. Call a signal **detecting** only if
it can fire at or before first customer impact; otherwise it is
**localizing**. An app-owned mechanism left as a follow-up means the incident
is not covered.
