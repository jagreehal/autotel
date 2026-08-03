---
name: design-alertable-metrics
description: >
  Designs metrics an alarm can actually be written against — picking the
  attributes that let a rule isolate one failing dependency, pinning metric
  names as a contract, keeping cardinality survivable, and verifying the name
  and labels that reach the backend before any query is written. Covers
  `Metric` (trackOutcome, trackValue, trackFunnelStep), SLO burn-rate alerting
  via `autotel/slo`, and the local loop that proves an alarm fires. Use this
  skill when adding metrics, writing or reviewing an alert rule, deciding what
  to put in labels, asking why an alert never fired or fires constantly, or
  when a query returns no data — even if the request only mentions
  "dashboards", "monitors", "alarms", "paging" or "SLOs" and never says
  metrics. Do not use for choosing what to trace — use skill
  `autotel-instrumentation`; for trace volume and cost — use skill
  `tune-sampling`; for the Grafana-specific file formats — use skill
  `autotel-grafana`.
---

# design-alertable-metrics

An alarm can only see what the metric's attributes let it group by. That
decision is made in application code, long before anyone opens a dashboard, and
it is the most common reason a real incident produces no page.

## When to use

- Adding a metric that something might one day alert on
- Writing or reviewing an alert rule or monitor
- "The provider was down for an hour and nothing fired"
- "This alert pages us every day and we've muted it"
- A dashboard panel or alert query returns no data
- Setting an SLO and wanting burn-rate alerts rather than threshold guesses

## Critical rules

- **Put the partition in the labels.** Whatever can fail independently —
  provider, carrier, region, tenant tier, queue — has to be an attribute, or no
  rule can isolate it. With two upstreams sharing traffic, one failing _every_
  request only moves a blended error rate to ~50%.
- **Separate outcome from reason.** `status=failure` says something broke;
  `reason=auth` is what makes the alert specific enough to route and to write a
  runbook for. Alert on the pair, not on a single error counter.
- **Pin metric names explicitly.** A name derived from the service name changes
  when the service is renamed, and every saved query breaks silently. Names are
  a contract with the alert rules; treat a rename as a breaking change.
- **Never label with an identity.** User id, order id, trace id, raw URL path
  and error message all belong on spans and events, not on metric labels. Each
  distinct value is a permanent time series.
- **Verify the landed name and labels before writing a query.** What the
  backend stores is not what you typed — see the workflow below.
- **Construct `Metric` after `init()`.** Instruments created before the SDK
  starts bind to a no-op meter and record nothing.

## Workflow

1. **Name the failure you want to be paged for**, in one sentence, including
   the thing that fails independently: "one carrier starts rejecting our quotes
   with 401".
2. **Instrument with that partition as an attribute**, plus outcome and reason:

   ```typescript
   import { init, Metric } from 'autotel';

   init({
     service: 'carrier-gateway',
     endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
   });

   // Metric names are the contract the alert rules are written against, so
   // they are pinned rather than derived from the service name.
   const metrics = new Metric('carrier-gateway', {
     metrics: {
       outcomes: { name: 'carrier.requests' },
       value: { name: 'carrier.request.duration_ms' },
     },
   });

   metrics.trackOutcome('carrier.quote', 'failure', {
     carrier, // the partition — what fails independently
     reason: 'auth', // what kind of failure — drives routing and the runbook
     http_status: 401,
   });
   metrics.trackValue('carrier.request.duration_ms', durationMs, { carrier });
   ```

   `trackOutcome` adds `service`, `operation` and `status` for you;
   `trackValue` adds `service` and `metric`.

3. **Run it against a real backend and read back what landed.** Do not skip
   this and do not infer the name from the code:

   ```bash
   # Which names exist
   curl -s localhost:9090/api/v1/label/__name__/values | jq '.data[] | select(contains("carrier"))'

   # Which labels each series actually carries
   curl -sG localhost:9090/api/v1/series --data-urlencode 'match[]=carrier_requests_total' | jq
   ```

   OTLP names are rewritten on the way in: dots become underscores, counters
   gain `_total`, histograms split into `_bucket` / `_sum` / `_count`, and a
   declared unit may be appended to the name. Resource attributes may land as
   `job` and `instance` rather than as labels. `carrier.requests` arrives as
   `carrier_requests_total`.

4. **Write the rule against the verified names, grouped by the partition:**

   ```promql
   sum by (carrier) (rate(carrier_requests_total{status="failure", reason="auth"}[5m]))
   /
   sum by (carrier) (rate(carrier_requests_total[5m]))
   ```

   Grouping both sides by the same label means a healthy partition produces no
   series and therefore no alert instance — no divide-by-zero guard needed.

5. **Make it fire before you ship it.** Reproduce the failure locally, watch
   the rule go Pending then Firing, and confirm it fires for the broken
   partition only. An alarm that has never fired is a guess; this step is what
   turns plausible YAML into a working alarm.
6. **Check the healthy partition stayed quiet.** An alert that fires for
   everything is the same outage as an alert that fires for nothing.

## Verifying locally

Metrics export every 60 seconds by default, so a script that runs for 40
seconds exports once at shutdown and `rate()` over a single point returns
nothing at all — which looks exactly like broken instrumentation.

```bash
OTEL_METRIC_EXPORT_INTERVAL=5000 pnpm start
```

If the metric still does not appear: the instrument was created before
`init()`, metrics are disabled in config, or the process exited before the
first export. Work down that list in order.

## Cardinality

Series count multiplies across labels: 5 carriers × 3 statuses × 4 reasons =
60 series, which is fine. Add `customer_id` and it is 60 × every customer,
forever — the backend charges for it and queries slow down for everyone.

| Signal | Right home for                                            |
| ------ | --------------------------------------------------------- |
| Metric | Bounded, low-cardinality dimensions you group or alert by |
| Span   | Per-request detail: ids, inputs, the full URL             |
| Event  | Business facts with an unbounded key space                |

If a label's value set grows with traffic, it belongs on a span. See
[`autotel-instrumentation`](../autotel-instrumentation/SKILL.md).

## SLO burn-rate alerting

Threshold alerts answer "is it broken right now". Burn-rate alerts answer "will
we miss the objective", which is the one worth waking someone for.

```typescript
import { createSloTracker, evaluateBurnRateAlert } from 'autotel/slo';

// One objective, two windows. The short one reacts; the long one confirms,
// so a one-minute blip does not page anyone.
const objective = { name: 'carrier.quote.availability', target: 0.99 };
const fast = createSloTracker({ ...objective, windowMs: 5 * 60_000 });
const slow = createSloTracker({ ...objective, windowMs: 60 * 60_000 });

for (const tracker of [fast, slow]) {
  tracker.record(ok ? 'good' : 'bad', { carrier });
}

const decision = evaluateBurnRateAlert({
  shortWindow: fast.snapshot(),
  longWindow: slow.snapshot(),
  shortThreshold: 14.4, // burning budget 14.4× faster than sustainable
  longThreshold: 6,
});

if (decision.alerting) page(decision.reason);
```

`snapshot()` returns `sli`, `burnRate`, `budgetConsumed` and `budgetRemaining`;
`forecast()` projects `timeToExhaustionMs` from a recent baseline. Alert on the
decision, not on raw error counts.

## Anti-patterns

| Pattern                                          | Why it hurts                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| One `errors_total` with no reason label          | Fires for everything, routes to nobody, has no runbook              |
| Blended error rate across every dependency       | One dependency failing completely stays under the threshold         |
| Metric name derived from the service name        | Renaming the service silently breaks every saved query and rule     |
| Alerting on a raw count instead of a ratio       | Fires on traffic growth, misses failures during quiet periods       |
| Writing the query from the code without checking | Name and labels are rewritten in transit; the query matches nothing |
| Shipping the rule untested                       | The first time it runs is during an incident, and it does not       |

## Related skills

- [`tune-sampling`](../tune-sampling/SKILL.md) — trace volume and cost; metrics are unsampled and stay complete
- [`find-observability-gaps`](../find-observability-gaps/SKILL.md) — which handlers emit nothing at all yet
- [`autotel-backends`](../../integrations/autotel-backends/SKILL.md) — vendor presets for the export side
- [`autotel-grafana`](../../integrations/autotel-grafana/SKILL.md) — turning these metrics into dashboards and alert rules that live in the repo
- [`autotel-schema`](../../integrations/autotel-schema/SKILL.md) — pinning attribute names as a versioned contract and diffing for breaking changes
