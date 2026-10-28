---
name: autotel-datadog
description: >
  Use this skill when a page runs Datadog RUM beside autotel-web, or when browser errors and traces should reach Datadog. joinDatadog(datadogRum) puts the autotel trace on every RUM error and the RUM session, user and replay link on spans; otlpRelay from autotel-backends/relay gets browser spans to Datadog without shipping the API key. Covers layering RUM and PostHog on Datadog tracing, and choosing one error tracker.
---

# autotel-datadog

Datadog RUM records sessions, views and replays. autotel-web records traces. `joinDatadog` links the two, and each layer stays optional: Datadog tracing alone, tracing plus RUM, or tracing plus RUM plus PostHog.

## Setup

```bash
pnpm add autotel-web autotel-datadog @datadog/browser-rum
```

```ts
import { datadogRum } from '@datadog/browser-rum';
import { initFull } from 'autotel-web/full';
import { joinDatadog } from 'autotel-datadog';

const datadog = joinDatadog(datadogRum, {
  traceUrl: ({ traceId }) => `https://app.datadoghq.eu/apm/trace/${traceId}`,
});

datadogRum.init({
  applicationId,
  clientToken,
  site: 'datadoghq.eu',
  service: 'web',
  env: 'production',
  version: '1.4.2',
  // No allowedTracingUrls: autotel traces the requests.
  beforeSend: datadog.beforeSend,
});

initFull({
  service: 'web',
  version: '1.4.2',
  environment: 'production',
  endpoint: '/otel', // the server relays to Datadog: see below
  captureErrors: false, // RUM owns errors
  spanEnrichers: [datadog],
});
```

## Core Patterns

### What the join adds

- RUM errors get `context.trace_id` (128-bit hex, as Datadog APM stores OpenTelemetry ids), `context.span_id` (decimal) and `context.trace_url`. Errors from failed requests carry that request's trace, even from a TanStack `onError` that runs after the span ended. A `trace_id` the app passes to `addError` is kept.
- Spans get `session.id` (the RUM session, also sent as baggage to same-origin requests), `user.id` from `setUser`, and `session.replay.url` on failed spans while replay records.

### Getting spans to Datadog

Datadog's OTLP intake needs the API key and refuses browsers. Relay through your server with `otlpRelay` from `autotel-backends/relay`:

```ts
const relay = otlpRelay(
  createDatadogConfig({ apiKey, site: 'datadoghq.eu', service: 'web' }),
);
app.post('/otel/v1/*', (c) => relay(c.req.raw));
```

### Layers and one error owner

Turn layers on independently and pick one tool for errors:

| Errors go to                 | Set                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| autotel (APM Error Tracking) | `captureErrors: true`, no RUM or PostHog error capture                                                |
| RUM                          | `captureErrors: false`; RUM collects errors                                                           |
| PostHog                      | `captureErrors: false`, PostHog `capture_exceptions: true`, drop `error` events in RUM's `beforeSend` |

With RUM and PostHog both on, create the error owner's join first: it owns `session.id`, and the other records its id as `datadog.session.id` or `posthog.session.id`. Logs and events carry the owner's session too.

### React

React 19 sends errors a boundary caught to `createRoot`'s `onCaughtError`, not `window.onerror`. Pass both callbacks to `addReactError` (RUM) or your error owner. With `reactPlugin({ router: true })` and react-router 7, import `createBrowserRouter` from `@datadog/browser-rum-react/react-router-v7`; the unversioned `/react-router` entry targets react-router 8.

## Common Mistakes

### HIGH: Writing `_dd.trace_id` in `beforeSend`

RUM reverts every `beforeSend` edit outside its allowlist, `_dd` included. The join writes `context.*`, which survives.

### HIGH: Two error trackers on

RUM plus `captureErrors: true` turns one uncaught error into two Datadog issues. Pick one owner.

### MEDIUM: A RUM `proxy` path traced by autotel

Add it to `initFull({ ignoreUrls: ['/rum-proxy'] })`. autotel already skips Datadog's own `browser-intake-*` hosts.

### MEDIUM: Dropping the domain context when chaining `beforeSend`

Write `datadog.beforeSend(event, context) && mine(event, context)`. The context carries the original error, which links a failed request's error to its trace.

## Version

Targets autotel-datadog v0.1. Optional peer: `autotel-web`. Reads `@datadog/browser-rum` 7 structurally.
