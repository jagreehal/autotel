# Autotel Web - Vanilla JavaScript Example

Ultra-lightweight example demonstrating browser-to-backend distributed tracing with autotel-web.

## What This Demonstrates

- ✅ **Lean mode**: Browser SDK initialization with `init()` (no OpenTelemetry deps, ~1.6KB)
- ✅ Automatic `traceparent` header injection on fetch requests
- ✅ Distributed tracing from browser → backend (using mock API)
- ✅ Accessing trace context in `trace(ctx => ...)` (traceId, spanId, correlationId)
- ✅ Using the `trace()` wrapper for DX

For **full mode** (real spans, `setAttribute`, network timing, user interaction), use `initFull` from `autotel-web/full` — see [autotel-web README](../../packages/autotel-web/README.md#full-mode-real-spans).

## Running the Example

### Prerequisites

Build the autotel-web package (from repo root or this app):

```bash
# From repo root
pnpm --filter autotel-web build

# Or from this directory
pnpm run build:autotel
```

### Option 1: pnpm start (recommended)

```bash
# From this directory (apps/example-web-vanilla)
pnpm start
```

Then open: **http://localhost:8000/apps/example-web-vanilla/**  
(The server runs from the repo root so the script can load `packages/autotel-web/dist/index.js`.)

To serve only this folder (e.g. for testing without loading autotel-web from repo), run `pnpm run start:local` and open http://localhost:8000 — but the autotel-web import will 404 unless you copy the built package into this app.

### Option 2: Other HTTP servers

```bash
# From this directory
python3 -m http.server 8000
# or
npx http-server -p 8000
# or
php -S localhost:8000
```

Then open: http://localhost:8000

### Option 3: VS Code Live Server

1. Install "Live Server" extension in VS Code
2. Right-click `index.html`
3. Select "Open with Live Server"

## Verifying Trace Propagation

1. Open the example in your browser
2. Open DevTools (F12)
3. Go to the **Network** tab
4. Click one of the buttons ("Make Simple Request" or "Make Traced Request")
5. Click on the request in the Network tab
6. Look for the **Request Headers** section
7. You should see:
   ```
   traceparent: 00-{trace-id}-{span-id}-01
   ```

Example traceparent header:
```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

## What's Happening

### 1. Browser Side (This Example)

```typescript
import { init, trace } from 'autotel-web'

// Initialize SDK (lean mode) - patches fetch/XHR globally
init({ service: 'vanilla-js-example', debug: true })

// traceparent header is automatically injected on all fetch calls
fetch('https://jsonplaceholder.typicode.com/posts/1')

// trace(ctx => ...) gives you traceId, spanId, correlationId
const doFetch = trace(ctx => async () => {
  const res = await fetch('/api/users/1')
  console.log('Trace ID:', ctx.traceId)
  return res.json()
})
```

### 2. Backend Side (Your API)

The backend using Autotel automatically extracts the `traceparent` header:

```typescript
// Backend (Express + Autotel)
import { init, trace } from 'autotel'

init({ service: 'my-api', endpoint: 'http://localhost:4318' })

app.get('/api/users', async (req, res) => {
  // traceparent header is automatically extracted from req.headers
  // This creates a child span continuing the browser's trace!
  const users = await trace(() => db.users.findAll())()
  res.json(users)
})
```

### 3. Observability Platform

View the complete distributed trace in your observability platform:
- Browser → API → Database (all in one trace!)
- See the full request flow with timing
- Correlate frontend and backend performance

## Bundle Size

The autotel-web SDK loaded by this example is only **1.6KB gzipped**!

Check the bundle in DevTools:
1. Network tab → JS filter
2. Look for `index.js` from autotel-web
3. Size column shows: ~5KB uncompressed, ~1.6KB gzipped

## Next Steps

1. **Try with your own API:** Replace the mock API URL with your backend
2. **Add Autotel to your backend:** See [Autotel docs](../../packages/autotel)
3. **View traces in your platform:** Connect your backend to Honeycomb, Datadog, Jaeger, etc.
4. **Try other examples:** Check out React, Next.js, and Vue examples (coming soon)

## Troubleshooting

### Headers not appearing?

1. Check the console for initialization message:
   ```
   [autotel-web] Initialized successfully
   ```

2. Ensure you're using `fetch()` or `XMLHttpRequest` (not other HTTP libraries)

3. Try enabling debug mode:
   ```typescript
   init({ service: 'my-app', debug: true })
   ```

### CORS issues?

This example uses `jsonplaceholder.typicode.com` which allows CORS. If you're testing with your own API:

1. Ensure your API allows the `traceparent` header
2. Add to your API's CORS config:
   ```javascript
   // Express example
   app.use(cors({
     exposedHeaders: ['traceparent', 'tracestate']
   }))
   ```

## Learn More

- [autotel-web Documentation](../../packages/autotel-web/README.md)
- [Autotel (Backend) Documentation](../../packages/autotel/README.md)
- [W3C Trace Context Specification](https://www.w3.org/TR/trace-context/)
