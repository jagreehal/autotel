# example-datadog-react-express

Frontend errors and traces from a Vite + React 19 + react-router 7 + TanStack
Query + axios SPA and an Express 4 API, in layers. Turn on only what you use:

| Layer           | Turned on by               | Adds                                                   |
| --------------- | -------------------------- | ------------------------------------------------------ |
| Traces (always) | `DATADOG_API_KEY` (server) | Browser → API → server spans in Datadog APM            |
| Datadog RUM     | `VITE_DD_RUM_*`            | Sessions, views by route, replay; RUM session on spans |
| PostHog         | `VITE_POSTHOG_KEY`         | Analytics, replay; PostHog session on spans            |
| Error owner     | `VITE_ERRORS` (optional)   | `autotel` · `rum` · `posthog`; the others stay quiet   |

Errors go to exactly one tool, defaulting to PostHog if it is on, else RUM,
else autotel's own spans (grouped by Datadog Error Tracking). Whichever owns
them, each error carries the trace of the request that caused it, and links
to that trace in Datadog.

`src/telemetry.ts` is the whole composition. The error owner's join is created
first, so its session is `session.id` on spans and in baggage; the other
recorder's is `datadog.session.id` or `posthog.session.id`.

## Run

```bash
pnpm --filter autotel --filter autotel-web --filter autotel-backends --filter autotel-datadog build
cp .env.example .env   # add DATADOG_API_KEY and DATADOG_SITE; RUM is optional
pnpm --filter @jagreehal/example-datadog-react-express dev
```

Open http://localhost:5174 and break things:

| Where                        | What fails                         | How it reaches Datadog                               |
| ---------------------------- | ---------------------------------- | ---------------------------------------------------- |
| Checkout → **Pay £42**       | `POST /api/checkout` answers 402   | TanStack `MutationCache.onError` → `reportError`     |
| Reports                      | `GET /api/reports` throws, 500     | TanStack `QueryCache.onError` → `reportError`        |
| Broken widget                | a component throws while rendering | React `onCaughtError` (router error boundary)        |
| **Throw in a click handler** | an uncaught `TypeError`            | `window.onerror`, captured by RUM or autotel-web     |
| **Unhandled rejection**      | a rejected promise nobody awaits   | `unhandledrejection`, captured by RUM or autotel-web |

## What makes it work

- **The API key stays on the server.** The page exports to `/otel` on its own
  origin, and `otlpRelay` (from `autotel-backends/relay`) forwards to
  Datadog's OTLP intake with the key added (`server/index.ts`). Datadog's
  intake would refuse a browser anyway (CORS).
- **Same origin in development, as behind a reverse proxy.** Vite proxies
  `/api` and `/otel` to Express with `xfwd: true` and without `changeOrigin`
  (the string shorthand turns it on), so the relay sees the page's origin.
- **Errors find their request's trace.** A failed query's `onError` runs after
  the request span has ended. autotel-web records which span each XHR and
  fetch `Response` belonged to, so the axios error, which carries its XHR as
  `error.request`, leads back to that trace. Same for RUM errors.
- **React errors are reported explicitly.** React 19 sends an error an error
  boundary caught to `createRoot`'s `onCaughtError`, not to `window.onerror`;
  `src/main.tsx` passes both callbacks to `reportReactError`.
- **Release and environment** (`VITE_APP_VERSION`, `VITE_APP_ENV`) become
  Datadog's `version` and `env` on spans and RUM, so issues show first-seen
  versions.

With the React plugin, import `createBrowserRouter` from
`@datadog/browser-rum-react/react-router-v7` for react-router 7. The
unversioned `/react-router` entry targets react-router 8.

## Every combination

All verified by `smoke.mjs`, which reads the active layers from the page:

| Traces  | RUM | PostHog | Errors  |
| ------- | --- | ------- | ------- |
| Datadog |     |         | autotel |
| Datadog | ✓   |         | rum     |
| Datadog |     | ✓       | posthog |
| Datadog | ✓   | ✓       | posthog |
| Datadog | ✓   | ✓       | rum     |

Without a RUM application, `VITE_DD_RUM_PROXY=/rum-intake` sends RUM through
the API (Datadog's documented proxy, which also survives ad blockers), and in
development the API keeps the events so the smoke test can read them. For the
smoke test with PostHog, start Vite with `VITE_POSTHOG_ALLOW_BOTS=true`:
posthog-js drops headless browsers as bots.

## Smoke

With the app running (`pnpm dev`):

```bash
DD_APP_KEY=… pnpm smoke
```

Drives every failure in Chromium, checks locally that each error is on its
request's trace, then reads the issues (or RUM errors), and the checkout
trace with both services, back from Datadog.
