# example-web-react-express

Lean `autotel-web` in a Vite + React 19 + axios SPA that calls an Express 4 API
on another origin. The API runs helmet, a hand-rolled CORS middleware, and
CommonJS telemetry loaded with `node --require`.

## Run

```bash
pnpm --filter autotel-web --filter autotel-posthog --filter autotel build
pnpm --filter @jagreehal/example-web-react-express api   # :8081
VITE_PROPAGATE_TO=localhost:8081 pnpm --filter @jagreehal/example-web-react-express web   # :5173
```

## Smoke

`node smoke.mjs` drives headless Chromium through six setups and checks what
reaches the server:

| Setup                                             | Result                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| `init()` with no `propagateTo`                    | Requests unchanged. No `traceparent` goes cross-origin                 |
| `propagateTo` set, API CORS without `traceparent` | The browser blocks the request at preflight                            |
| `propagateTo` set, API allows `traceparent`       | The server span is a child of the browser's, for axios (XHR) and fetch |
| API samples 1% parent-based, browser default      | The API keeps each request the browser marks sampled                   |
| Same, browser `sampleRate`                        | Unsampled sessions send `-00` and the API drops them                   |
| posthog-js on the page                            | Browser spans carry PostHog's `session.id`                             |

## Turning propagation on

1. Add `traceparent` and `baggage` to the API's `Access-Control-Allow-Headers`,
   then ship `propagateTo`.
2. If the API head-samples parent-based, give the browser the same
   `sampleRate`.
3. With PostHog, pass the instance you import:
   `session: { id: () => posthogSessionId(posthog) }`.

Lean mode records browser spans for `fetch` and propagates on both `fetch` and
XHR. Use `initFull` for browser spans on axios calls.
