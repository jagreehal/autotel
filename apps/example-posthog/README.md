# example-posthog

A checkout that fails. The browser span gets PostHog's session id. The PostHog
event gets `$trace_id`. The server span gets `session.id` from W3C baggage.

## Run

```bash
pnpm install
pnpm --filter autotel-web --filter autotel-posthog --filter autotel build
pnpm --filter @jagreehal/example-posthog start
```

Open http://localhost:8787 and click **Fail checkout**.

The page prints `session.id`, `session.replay.url`, `$trace_id` and
`$trace_url`. The server terminal prints the incoming `baggage` header and the
pretty span for `POST /checkout` — look for `session.id` on that span.

## Live or stub

Copy `.env.example` to `.env` and set `POSTHOG_KEY` to run against a real
project. Leave it unset and the page uses a stub, so the example runs with no
account. The server prints which one it picked at startup.

## What to notice

`posthog.capture()` happens **after** `await fetch(...)`. The browser has no
`AsyncLocalStorage`, so OpenTelemetry's active span is already gone by then —
`joinPostHog` recovers it from the spans still in flight. No Zone.js, no manual
`context.with()`.

`session.replay.url` is absent unless session replay is enabled and recording
for that session. The enricher gates on `sessionRecordingStarted()` rather than
linking to an empty player.

Driving this with Playwright or Puppeteer? `posthog-js` drops headless Chrome
as bot traffic before `before_send` runs, so nothing reaches PostHog and
nothing gets stamped. Set `opt_out_useragent_filter: true` on the instance in
the test only.

## What to read

- [PostHog join](https://jagreehal.github.io/autotel/integrations/posthog/)
- [`autotel-posthog`](../../packages/autotel-posthog)
