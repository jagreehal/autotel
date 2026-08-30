---
name: autotel-posthog
description: >
  Use this skill when joining autotel traces to PostHog sessions, replays and events — `joinPostHog()` for both directions in one call, `posthogCompatibility()` to stamp session and replay links onto spans, `autotelBeforeSend()` to put `$trace_id` on PostHog events, and `PostHogSubscriber` for server-side `track()`. Covers the async-context trap that silently drops the join after the first `await`.
---

# autotel-posthog

PostHog knows which recorded session a moment belongs to and who is behind it. autotel knows which trace explains that moment. This package is the join, in both directions, and it depends on no PostHog package: it reads the public browser API structurally off whatever instance is on the page.

One package covers PostHog end to end. The browser join is on `autotel-posthog`; server-side product events are on `autotel-posthog/subscriber`.

## Setup

The two entry points need different things, so install the half you use.

```bash
# Browser join
npm install autotel-posthog posthog-js autotel-web

# Server events
npm install autotel-posthog posthog-node autotel autotel-subscribers
```

`autotel-web` is required rather than optional: the root entry imports `autotel-web/baggage` at module scope for the session hop. `posthog-js` is never bundled, because two copies on one page means two session managers and two answers to `get_session_id()`, which breaks the join this package exists to make.

## Core Patterns

### One call wires both directions

```typescript
import posthog from 'posthog-js';
import { initFull } from 'autotel-web/full';
import { joinPostHog } from 'autotel-posthog';

posthog.init('<key>');

initFull({
  service: 'web',
  endpoint: 'https://collector.example.com/v1/traces',
  spanEnrichers: [joinPostHog(posthog)],
});
```

`joinPostHog` appends to any `before_send` chain the app already has rather than replacing it, and calling it again under strict mode, HMR or a re-render does not stack another copy.

Add `traceUrl` and PostHog events carry a link rather than ids to join on:

```typescript
joinPostHog(posthog, {
  traceUrl: ({ traceId }) => `https://traces.example.com/${traceId}`,
  featureFlags: ['new-checkout'],
});
```

### Use `spanEnrichers`, never `spanProcessor`

`spanProcessor` replaces the pipeline autotel builds, so passing an enricher there switches off the export you just configured.

### Trace → PostHog, on its own

```typescript
import { posthogCompatibility } from 'autotel-posthog';

initFull({ service: 'web', endpoint, spanEnrichers: [posthogCompatibility()] });
```

| Attribute            | Source                                                    | On which spans                |
| -------------------- | --------------------------------------------------------- | ----------------------------- |
| `session.id`         | `posthog.get_session_id()`                                | Every span                    |
| `user.id`            | `posthog.get_distinct_id()`                               | Every span                    |
| `session.replay.url` | `posthog.get_session_replay_url({ withTimestamp: true })` | Spans that recorded an error  |
| `feature_flag.*`     | `posthog.getFeatureFlag(key)`                             | Every span, for keys you name |

Identity is read when the span **starts**. PostHog rotates a session after 30 minutes idle and `identify()` can land mid-request, so a long span asking at the end would be filed under whoever the visitor had become. The replay link is decided at the end, because only the end knows whether the span failed, and it is withheld if the session rotated in between.

The link appears only when `sessionRecordingStarted()` is true. `get_session_replay_url()` composes a URL from the session id whether or not anything was recorded, so replay being disabled or sampled out would otherwise produce a link landing on an empty player.

### Name feature flags, never harvest them

```typescript
posthogCompatibility({ featureFlags: ['new-checkout'] });
```

Every flag is another attribute on every span. Naming them keeps an analytics convenience from becoming a cardinality bill. A flag PostHog has no opinion on yet is omitted — recording it as `false` would make "off" and "unknown" the same reading. One that genuinely evaluated to `false` is kept, because that is an answer and comparing the two groups is the point.

Flags are recorded under the **canonical** OpenTelemetry convention —
`feature_flag.key`, `feature_flag.result.value`, `feature_flag.result.variant`,
`feature_flag.provider.name`, `feature_flag.context.id` — plus one
`feature_flag.evaluation` event per flag. Values keep their type: a boolean flag
records `true`, not `"true"`. Never suggest `feature_flag.<key>`:
keyed by flag name it cannot be grouped across flags, and no backend ships a
panel that reads it. Span attributes hold one flag (a second overwrites the
first), which is why the events carry the rest.

Reasons are normalised to the registry's lower snake case (`targeting_match`),
and the per-flag events are correlated log records rather than span events.

Outside PostHog, `recordFeatureFlag()` and `autotelOpenFeatureHook()` from
`autotel/feature-flags` do the same job for any provider.

### PostHog → trace, on its own

```typescript
import { autotelBeforeSend } from 'autotel-posthog';

posthog.init('<key>', { before_send: [autotelBeforeSend()] });
```

Stamps `$trace_id`, `$span_id` and, with `traceUrl`, `$trace_url` on every event, using the same property names the server-side subscriber writes. Events an earlier hook dropped stay dropped, because `null` in a `before_send` chain means the page suppressed the event deliberately.

### The `await` trap

The browser has no `AsyncLocalStorage`, so OpenTelemetry's active context is gone by the first `await` — which is exactly where the events worth joining fire.

```typescript
await span('checkout.click', async () => {
  await fetch('/checkout', { method: 'POST' });
  // The active span is already gone here. joinPostHog still finds it.
  posthog.capture('checkout_failed', { message: 'Card declined' });
});
```

`joinPostHog` falls back to the most recent span it has seen start and not yet end, so no Zone.js and no manual `context.with()`. It refuses to guess when guessing could be wrong: two overlapping user actions each start their own trace, and with no active context nothing says which one an event belongs to, so nothing is added rather than a trace id pointing at an unrelated request. Development says so in the console and names the fix.

The fix is to read the ids while the span is still active:

```typescript
import { traceProperties } from 'autotel-posthog';

await span('checkout.click', async () => {
  const trace = traceProperties();
  await fetch('/checkout', { method: 'POST' });
  posthog.capture('checkout_failed', { ...trace, message: 'Card declined' });
});
```

`traceProperties()` returns `{}` when nothing is being traced, so the spread is always safe, and a property the caller set is never overwritten.

`autotelBeforeSend()` alone reads only the active context. Pass `fallbackSpanContext` for the same behaviour without the enricher.

### Carry the session to the server

`joinPostHog` copies PostHog's session id onto subsequent same-origin fetches as W3C `baggage` (`propagateSession`, default on). The backend stamps it on the handler span:

```typescript
init({ service: 'api', endpoint, baggage: '' });
```

`baggage: ''` writes `session.id`; `baggage: true` would write `baggage.session.id`. Distinct id stays off, because it can be an email. Needs `autotel` 7.0.1 or later, since earlier versions read the empty string as "off".

### Server-side product events

```typescript
import { Event } from 'autotel/event';
import { PostHogSubscriber } from 'autotel-posthog/subscriber';

const events = new Event('checkout', {
  subscribers: [
    new PostHogSubscriber({ apiKey: process.env.POSTHOG_API_KEY! }),
  ],
});
```

`track()` events carry `$trace_id` and `$span_id`, the same names the browser hook writes, so an event points back at its trace whichever side captured it. Needs `autotel-subscribers` alongside for the `EventSubscriber` base.

### Without the OpenTelemetry pipeline

The minimal `autotel-web` build writes straight to OTLP and has no processor pipeline to hang an enricher on. Give it the session id directly:

```typescript
import { init } from 'autotel-web';
import { posthogSessionId } from 'autotel-posthog';

init({ service: 'web', session: { id: posthogSessionId } });
```

## When nothing shows up

Every failure is quiet on purpose — a missing PostHog, a rotated session, replay switched off all produce no attribute. `debug` is on by default in development and silent in production, and each exit says why once per reason.

A page is in one of three states, and only the last answers questions: no `posthog` at all, the loader snippet's array stub, or the loaded library, which still returns an empty session id until it finishes initializing. Every call is guarded for all three.

### Testing end to end

`posthog-js` drops bots, headless Chrome included, **before** `before_send` runs, so a Playwright or Puppeteer test sees no events and no stamping, with no error to explain it:

```typescript
await page.evaluate(() =>
  window.posthog.set_config({ opt_out_useragent_filter: true }),
);
```

PostHog still classifies that traffic as a bot server-side, so filter it out of your own analysis rather than leaving this in production code.

## Review Checklist

- `spanEnrichers`, not `spanProcessor`
- Feature flags named explicitly, never harvested
- `traceProperties()` used where a capture follows an `await`, rather than trusting the active context
- One copy of `posthog-js` on the page
- `baggage: ''` on the server when the session should reach handler spans
- Bot filtering turned off only on the instance under test

## Which session id wins

Where PostHog has a session id it replaces the one `autotel-web` mints, because PostHog's id is what the replay, the funnels and the person profile are keyed on. Where PostHog has none yet the local id stands, since spans with no session are worse than spans with a session only autotel knows about. `user.id` and the rest are filled, never overwritten.
