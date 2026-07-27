---
name: autotel-custom-subscriber
description: >
  Use this skill when routing autotel product events (track(), Event) to a destination that has no built-in subscriber — a data warehouse, an internal queue, a custom HTTP sink. Implement the EventSubscriber interface (trackEvent, trackFunnelStep, trackOutcome, trackValue) with zero runtime deps, or extend the base class for retry and graceful shutdown, then register via init({ subscribers }). Also covers defineEnricher for adding computed fields to every event.
---

# autotel-custom-subscriber

`autotel-subscribers` ships PostHog, Mixpanel, Amplitude, Segment, Slack, and webhook sinks. When your destination isn't one of those, write your own subscriber. Autotel fans every `track()` / `Event` call out to each registered subscriber, so your code stays the same and the new sink just receives the events.

## When to use

- Send events to a warehouse, queue, or internal API with no packaged subscriber.
- Add a side-channel (audit log, real-time dashboard) that consumes the same events.
- Attach computed fields to every event before it leaves the process.

## Option A: implement the interface (zero dependencies)

`EventSubscriber` from `autotel/event-subscriber` is types only. Implement the four track methods and register the instance.

```ts
import type {
  EventSubscriber,
  EventAttributes,
  EventTrackingOptions,
  FunnelStatus,
  OutcomeStatus,
} from 'autotel/event-subscriber';

export class WarehouseSubscriber implements EventSubscriber {
  readonly name = 'WarehouseSubscriber';

  async trackEvent(
    name: string,
    attributes?: EventAttributes,
    options?: EventTrackingOptions,
  ) {
    await this.write({
      type: 'event',
      name,
      attributes,
      autotel: options?.autotel,
    });
  }
  async trackFunnelStep(
    funnel: string,
    step: FunnelStatus,
    attributes?: EventAttributes,
    options?: EventTrackingOptions,
  ) {
    await this.write({
      type: 'funnel',
      funnel,
      step,
      attributes,
      autotel: options?.autotel,
    });
  }
  async trackOutcome(
    operation: string,
    outcome: OutcomeStatus,
    attributes?: EventAttributes,
    options?: EventTrackingOptions,
  ) {
    await this.write({
      type: 'outcome',
      operation,
      outcome,
      attributes,
      autotel: options?.autotel,
    });
  }
  async trackValue(
    name: string,
    value: number,
    attributes?: EventAttributes,
    options?: EventTrackingOptions,
  ) {
    await this.write({
      type: 'value',
      name,
      value,
      attributes,
      autotel: options?.autotel,
    });
  }

  private async write(payload: unknown) {
    // your sink: warehouse insert, queue publish, fetch()
  }
}
```

```ts
import { init } from 'autotel';

init({
  service: 'my-app',
  subscribers: [new WarehouseSubscriber()],
});
```

`options.autotel` carries the trace context (trace id, span id) so events correlate with spans. Include it in your payload.

## Option B: extend the base class (retry + graceful shutdown)

`autotel-subscribers` exports an abstract `EventSubscriber` base that tracks pending requests, retries, and drains on shutdown. Subclass it and implement one method.

```ts
import { EventSubscriber, type EventPayload } from 'autotel-subscribers';

export class WarehouseSubscriber extends EventSubscriber {
  readonly name = 'WarehouseSubscriber';

  constructor(private readonly url: string) {
    super();
  }

  protected async sendToDestination(payload: EventPayload): Promise<void> {
    await fetch(this.url, { method: 'POST', body: JSON.stringify(payload) });
  }
}
```

The base normalizes every track call into one `EventPayload`, so you write one `sendToDestination` instead of four track methods.

## Enrich every event

`defineEnricher` merges computed fields into a chosen top-level field of each event, before subscribers see it.

```ts
import { defineEnricher } from 'autotel';

const withPlan = defineEnricher({
  name: 'plan-enricher',
  field: 'user',
  compute: (ctx) => ({ plan: lookupPlan(ctx.event.user?.id) }),
});
```

`compute` returning `undefined` skips enrichment. A throw is caught and logged, so a broken enricher never drops the event.

## Common mistakes

### HIGH: Throwing from `sendToDestination` / a track method

A throw can break the emit path for other subscribers. Catch and log inside your sink; the base class already does this if you extend it.

### MEDIUM: Dropping `options.autotel`

Without it, your events lose the trace/span ids and can't be correlated with spans in your backend. Forward it in the payload.

## Related

- `autotel-subscribers` — the built-in sinks; check there before writing your own.
- `autotel-custom-exporter` — the equivalent extension point for spans rather than events.
