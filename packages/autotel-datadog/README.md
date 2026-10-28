# autotel-datadog

Join autotel-web's traces to [Datadog RUM](https://docs.datadoghq.com/real_user_monitoring/) on the same page. RUM keeps capturing errors, sessions and replays; autotel does the tracing.

- **RUM errors carry the trace.** Every RUM error gets `context.trace_id`, `context.span_id` and, if you want, `context.trace_url`, even when it is captured after an `await` (where the browser has already lost the active span). The ids are in the form Datadog APM stores: the trace id as 128-bit hex, the span id in decimal. So `@context.trace_id:<id>` in RUM and `trace_id:<id>` in APM find each other.
- **Spans carry the RUM session.** Every span gets `session.id` (the RUM session, also sent to your server as W3C baggage) and `user.id` (from `datadogRum.setUser`). Failed spans also get `session.replay.url`, the RUM replay link, when replay is recording.

No Datadog package is imported: the `datadogRum` you pass in is read structurally.

```bash
pnpm add autotel-web autotel-datadog @datadog/browser-rum
```

## Usage

```typescript
import { datadogRum } from '@datadog/browser-rum';
import { initFull } from 'autotel-web/full';
import { joinDatadog } from 'autotel-datadog';

const datadog = joinDatadog(datadogRum, {
  traceUrl: ({ traceId }) => `https://app.datadoghq.eu/apm/trace/${traceId}`,
});

datadogRum.init({
  applicationId: '<APP_ID>',
  clientToken: '<CLIENT_TOKEN>',
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
  endpoint: '/otel', // your server relays to Datadog: see below
  spanEnrichers: [datadog],
});
```

`beforeSend` never drops an event. To keep a hook of your own as well:

```typescript
beforeSend: (event, context) => datadog.beforeSend(event) && mine(event, context),
```

### Why `context.trace_id` and not Datadog's own trace link

RUM's `beforeSend` may change only a short list of fields (`context`, `error.message`, `error.stack`, `error.fingerprint`, `view.*`, `service`, `version`) and silently reverts everything else. The field RUM uses for its own "view trace" link, `_dd.trace_id`, is not on that list, so nothing outside RUM can set it. `context.trace_id` is the closest thing that survives: searchable in RUM and Error Tracking, and `traceUrl` turns it into a link.

## Getting spans to Datadog

Datadog's OTLP intake authenticates with your API key, which must not ship to a page, and it does not accept browser requests (CORS). So the page exports to its own origin and your server forwards the request with the key added, using `otlpRelay` from `autotel-backends`:

```typescript
import { otlpRelay } from 'autotel-backends/relay';
import { createDatadogConfig } from 'autotel-backends/datadog';

const relay = otlpRelay(
  createDatadogConfig({ apiKey, site: 'datadoghq.eu', service: 'web' }),
);
app.post('/otel/v1/*', (c) => relay(c.req.raw)); // Hono; any Request/Response framework works
```

## Two error trackers, one error

With RUM on the page, an uncaught error is recorded twice: by RUM (a RUM error) and by autotel-web's own error capture (an exception on a span, which Datadog Error Tracking also groups as an issue). If RUM is your error tracker, turn autotel's capture off with `initFull({ captureErrors: false })`. Spans that fail still record their exceptions.

## Example

[`apps/example-datadog`](../../apps/example-datadog): `pnpm web` runs the browser join, and `pnpm smoke:web` checks it in Chromium and against a Datadog org.
