# autotel-posthog

Join autotel traces to PostHog sessions, replays and events. One session id, and a link in both directions.

PostHog knows two things a tracer cannot work out for itself: which recorded session a page view belongs to, and which person is behind it. autotel knows which trace explains a given moment. This package is the join, and it depends on no PostHog package to make it — the methods it reads are the public browser API, read structurally off whatever instance is on the page.

It is also where `PostHogSubscriber` lives, so one package covers PostHog end to end: the browser join on `autotel-posthog`, product events from the server on `autotel-posthog/subscriber`.

## Install

The two entry points need different things, so install the half you use.

```bash
# Browser join — needs the SDK whose session you are joining
npm install autotel-posthog posthog-js autotel-web

# Server events
npm install autotel-posthog posthog-node autotel autotel-subscribers
```

Every peer is declared optional so the half you skip does not warn about
packages it will never import. `posthog-js` is not bundled: two copies on one
page means two session managers and two different answers to
`get_session_id()`, which would break the join this package exists to make.

## The short version

One call wires both directions — PostHog's half itself, and the enricher for the tracer's half:

```ts
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

`joinPostHog` appends its hook to any `before_send` chain the app already has rather than replacing it, and calling it again — strict mode, HMR, a re-render — does not stack up another copy.

Add `traceUrl` and PostHog events carry a link, not just ids to join on:

```ts
spanEnrichers: [
  joinPostHog(posthog, {
    traceUrl: ({ traceId }) => `https://traces.example.com/${traceId}`,
    featureFlags: ['new-checkout'],
  }),
],
```

Everything below is what `joinPostHog` does, for anyone who wants the halves separately.

## The halves, separately

### Trace → PostHog

`posthogCompatibility()` is a span enricher. It stamps the PostHog session and person onto spans, and on spans that failed, a replay link deep-linked to the moment it broke.

```ts
import { initFull } from 'autotel-web/full';
import { posthogCompatibility } from 'autotel-posthog';

initFull({
  service: 'web',
  endpoint: 'https://collector.example.com/v1/traces',
  spanEnrichers: [posthogCompatibility()],
});
```

| Attribute            | Source                                                    | On which spans                |
| -------------------- | --------------------------------------------------------- | ----------------------------- |
| `session.id`         | `posthog.get_session_id()`                                | every span                    |
| `user.id`            | `posthog.get_distinct_id()`                               | every span                    |
| `session.replay.url` | `posthog.get_session_replay_url({ withTimestamp: true })` | spans that recorded an error  |
| `feature_flag.<key>` | `posthog.getFeatureFlag(key)`                             | every span, for keys you name |

Identity is read when the span **starts**, not when it ends. PostHog rotates a session after 30 minutes idle and `identify()` can land mid-request; a long span asking at the end would be filed under whoever the visitor had become by then. The replay link is the one thing decided at the end, because only the end knows whether the span failed — and it is withheld if the session rotated in between, since the link would point at a recording the span has nothing to do with.

A flag that evaluates to `false` is kept as a boolean: "not in the variant" is an answer, and comparing the two groups is the whole point. Only a flag PostHog has no opinion on is omitted.

Use `spanEnrichers`, not `spanProcessor`. The latter _replaces_ the pipeline autotel builds, so passing an enricher there switches off the export you just configured.

An error span now carries a link to the replay at the second it broke, in whatever backend the spans land in — so "a slow span" becomes "watch the person it was slow for" without leaving the trace view.

The link appears only when `posthog.sessionRecordingStarted()` is true. `get_session_replay_url()` composes a URL from the session id whether or not anything was recorded, so replay being disabled, sampled out, or simply not started yet would otherwise produce a link that lands on an empty player — and one dead link is enough to stop people trusting the ones that work. An instance too old or too stubbed to answer produces no link rather than a confident wrong one.

#### Feature flags are named, never harvested

```ts
posthogCompatibility({ featureFlags: ['new-checkout'] });
```

Every flag is another attribute on every span. Naming them is what keeps an analytics convenience from becoming a cardinality bill. A flag PostHog has no opinion on yet is omitted; one that evaluated to `false` is kept, because that is an answer.

### PostHog → trace

`autotelBeforeSend()` is a PostHog `before_send` hook. It stamps `$trace_id`, `$span_id` and — when you supply `traceUrl` — `$trace_url` on every PostHog event from the span in progress, using the same property names autotel's server-side subscriber already writes.

```ts
import posthog from 'posthog-js';
import { autotelBeforeSend } from 'autotel-posthog';

posthog.init('<key>', { before_send: [autotelBeforeSend()] });
```

A `$exception` or a funnel drop-off in PostHog now names the trace that explains it. Events an earlier hook dropped stay dropped: `before_send` is a chain, and `null` means the page suppressed the event deliberately.

## Product events from the server

```ts
import { Event } from 'autotel/event';
import { PostHogSubscriber } from 'autotel-posthog/subscriber';

const events = new Event('checkout', {
  subscribers: [
    new PostHogSubscriber({ apiKey: process.env.POSTHOG_API_KEY! }),
  ],
});
```

Server-side `track()` events go to PostHog carrying `$trace_id` and `$span_id` — the same property names the browser hook writes, so an event points back at its trace whichever side captured it. Needs `autotel-subscribers` alongside it, for the `EventSubscriber` base it extends.

## Without the OpenTelemetry pipeline

The minimal `autotel-web` build writes spans straight to OTLP and has no processor pipeline to hang an enricher on. Give it the session id directly:

```ts
import { init } from 'autotel-web';
import { posthogSessionId } from 'autotel-posthog';

init({ service: 'web', session: { id: posthogSessionId } });
```

## Three states, one of which answers questions

A page is in one of three states, and only the last one can be asked anything:

1. no `posthog` on the page at all,
2. the loader snippet's array stub, which queues calls made before the real library arrives and has none of these methods,
3. the loaded library — which still returns an empty session id until it finishes initializing.

Every call this package makes is guarded for all three. Analytics that is still starting up never throws inside a fetch handler, and never produces an attribute that means nothing.

## Which session id wins

Where PostHog has a session id, it replaces the one `autotel-web` mints for itself. PostHog's id is what the replay, the funnels and the person profile are all keyed on, so a span carrying any other id links to nothing. Where PostHog has none yet, the locally minted id stands, because spans with no session at all are worse than spans with a session only autotel knows about.

`user.id` and the rest are filled, never overwritten — a span that set them already knows something this package does not.

## License

Apache-2.0
