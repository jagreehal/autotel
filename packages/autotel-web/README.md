# autotel-web

Ultra-lightweight browser SDK for distributed tracing (**1.6KB gzipped**)

**Purpose:** Enable distributed tracing between browser and backend applications. The browser propagates W3C `traceparent` headers, and your backend (using [Autotel](../autotel)) automatically continues the trace.

**Core Philosophy:** The backend does all the real tracing — timing, spans, errors, export — while the browser only propagates the trace context via headers.

**No OpenTelemetry dependencies. No exporters. No collectors. No CORS. Just header injection.**

```
┌─────────┐  traceparent   ┌─────────┐   spans    ┌───────────┐
│ Browser │  ----------->  │ Backend │  ------->  │ Collector │
│  1.6KB  │    header      │ (OTel)  │   export   │ (Datadog) │
└─────────┘                └─────────┘            └───────────┘
```

## Features

✅ **Tiny bundle** - **1.6KB gzipped** (33x smaller than full OTel browser SDK)
✅ **Zero dependencies** - No `@opentelemetry/*` packages needed
✅ **W3C trace propagation** - Automatic `traceparent` header injection on fetch/XHR
✅ **SSR-safe** - Works with Next.js, Remix, and other SSR frameworks
✅ **Framework-agnostic** - Works with React, Vue, Svelte, Angular, vanilla JS
✅ **No Zone.js** - [Context propagation without global patching](#context-propagation-without-zonejs)

## Installation

```bash
npm install autotel-web
# or
pnpm add autotel-web
# or
yarn add autotel-web
```

**Important:** You do NOT need to install any `@opentelemetry/*` packages yourself. One install gives you both modes below.

### Lean vs Full mode

- **Lean (default)** – `import { init } from 'autotel-web'`. Zero dependencies, ~1.6KB gzipped. Only injects W3C `traceparent` on fetch/XHR; no real spans in the browser. Backend does the real tracing.
- **Full** – `import { initFull } from 'autotel-web/full'`. Real spans (navigation, fetch/XHR, optional user interaction), optional `http.client.network_timing` events, **Web Vitals** (LCP, INP, CLS, FCP, TTFB), **unhandled error capture**, optional long-task capture, sampling, and OTLP export. No Zone.js; bundle size is larger (~40–50KB gzipped). Use when you need client-side spans and export from the browser.

Use lean mode by default; use full mode when you need real browser spans and network timing. You can use dynamic import to load full mode only when needed: `import('autotel-web/full').then(({ initFull }) => initFull(config))`.

## Quick Start

### 1. Initialize in Browser

```typescript
import { init } from 'autotel-web'

// Call once, client-side only
init({ service: 'my-frontend-app' })

// That's it! All fetch/XHR calls now include traceparent headers
fetch('/api/users')  // <-- traceparent header automatically injected!
```

### 2. Backend Receives Trace

Your backend using Autotel automatically extracts the `traceparent` header and continues the trace:

```typescript
// Backend (Express + Autotel)
import { init, trace } from 'autotel'

init({
  service: 'my-api',
  endpoint: 'http://localhost:4318'  // Your OTel collector
})

app.get('/api/users', async (req, res) => {
  // Autotel automatically extracts traceparent from req.headers
  // and creates a child span
  const users = await trace(async () => {
    return db.users.findAll()
  })()

  res.json(users)
})
```

### 3. View Distributed Trace

Open your observability platform (Honeycomb, Datadog, Jaeger, etc.) and see the complete trace from browser → backend → database!

## Full mode (real spans)

When you need real browser spans, network timing events, and optional export from the client, use full mode. Same install: `autotel-web`. No Zone.js.

```typescript
import { initFull } from 'autotel-web/full'

initFull({
  service: 'my-app',
  endpoint: 'https://your-collector.example.com/v1/traces',  // OTLP HTTP
  sampleRate: 0.1,                    // e.g. 10% in production
  captureNavigation: true,            // document load spans (default: true)
  captureFetch: true,
  captureXHR: true,
  captureNetworkTiming: true,         // http.client.network_timing events (semantic-conventions#3385)
  captureErrors: true,                // unhandled errors → span.recordException (default: true)
  captureWebVitals: true,             // LCP, INP, CLS, FCP, TTFB as web_vitals span (default: true)
  webVitals: { reportAllChanges: false },  // pass through to web-vitals (default: false)
  captureLongTasks: false,            // long-task spans (main thread >= 50ms); opt-in, can be noisy
  copyHttpSpanAttributesToEvent: false,
  userInteraction: {
    enabled: true,
    selectors: ['button', 'a', '[data-track]'],
  },
  privacy: { allowedOrigins: ['api.myapp.com'], respectDoNotTrack: true },
  debug: false,
})
```

With sensible defaults, **one `initFull()`** gives you: **navigation spans**, **fetch/XHR spans** with W3C propagation, **http.client.network_timing** events, **Web Vitals** (LCP, INP, CLS, FCP, TTFB) as a single `web_vitals` span per page, and **unhandled error capture** (window errors and unhandled promise rejections). Optional: **user interaction** spans (clicks on configurable selectors), **long-task** spans (opt-in via `captureLongTasks: true`), **sampling** (`sampleRate` or custom `sampler`), and **setAttribute** / **addEvent** / **span()** on the active span. Async context propagation is best-effort (no Zone.js).

## Framework Integration

### React (Client-Only)

```typescript
// src/App.tsx
import { useEffect } from 'react'
import { init } from 'autotel-web'

function App() {
  useEffect(() => {
    init({ service: 'my-react-app' })
  }, [])

  return <div>Your app</div>
}
```

### Next.js App Router (SSR-Safe)

```typescript
// app/telemetry-init.tsx (Client Component)
'use client'

import { useEffect } from 'react'
import { init } from 'autotel-web'

export function TelemetryInit() {
  useEffect(() => {
    init({ service: 'my-nextjs-app' })
  }, [])

  return null
}

// app/layout.tsx
import { TelemetryInit } from './telemetry-init'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TelemetryInit />
        {children}
      </body>
    </html>
  )
}
```

### Next.js Pages Router

```typescript
// pages/_app.tsx
import { useEffect } from 'react'
import { init } from 'autotel-web'
import type { AppProps } from 'next/app'

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    init({ service: 'my-nextjs-app' })
  }, [])

  return <Component {...pageProps} />
}
```

### Remix

```typescript
// app/entry.client.tsx
import { RemixBrowser } from '@remix-run/react'
import { startTransition, StrictMode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { init } from 'autotel-web'

// Initialize before hydration
init({ service: 'my-remix-app' })

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <RemixBrowser />
    </StrictMode>
  )
})
```

### Vue

```typescript
// src/main.ts
import { createApp } from 'vue'
import { init } from 'autotel-web'
import App from './App.vue'

init({ service: 'my-vue-app' })

createApp(App).mount('#app')
```

### Vanilla JavaScript

```html
<!-- index.html -->
<script type="module">
  import { init } from 'autotel-web'

  init({ service: 'my-vanilla-app' })

  // Now all fetch calls include traceparent headers
  fetch('/api/data')
    .then(res => res.json())
    .then(data => console.log(data))
</script>
```

## W3C Trace Context Propagation

autotel-web **implements the W3C Trace Context format directly**, without pulling in the OpenTelemetry propagator. It generates and injects `traceparent` headers on all outgoing HTTP requests using native browser APIs (`crypto.getRandomValues()`).

### Header Format

```
traceparent: 00-{trace-id}-{span-id}-{trace-flags}
```

**Example:**
```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

- `00` - Version
- `4bf92f3577b34da6a3ce929d0e0e4736` - Trace ID (128-bit hex)
- `00f067aa0ba902b7` - Span ID (64-bit hex)
- `01` - Trace flags (sampled=1)

### Verification

You can verify the header is being sent using browser DevTools:

1. Open DevTools → Network tab
2. Make a fetch/XHR request
3. Check Request Headers
4. Look for `traceparent` header

## Backend Integration

### Automatic Extraction (Express)

Autotel automatically extracts `traceparent` from incoming requests:

```typescript
import express from 'express'
import { init, trace } from 'autotel'

init({
  service: 'my-api',
  endpoint: 'http://localhost:4318'
})

const app = express()

app.get('/api/users/:id', async (req, res) => {
  // Parent context is automatically extracted from req.headers.traceparent
  const user = await trace(async () => {
    return db.users.findById(req.params.id)
  })()

  res.json(user)
})
```

### Manual Extraction (Next.js API Routes)

For frameworks where automatic extraction doesn't work, use `extractTraceContext`:

```typescript
// app/api/users/route.ts (Next.js App Router)
import { init } from 'autotel'
import { context, trace as otelTrace } from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'

init({ service: 'my-api', endpoint: 'http://localhost:4318' })

const propagator = new W3CTraceContextPropagator()

export async function GET(request: Request) {
  // Extract parent context from headers
  const parentContext = propagator.extract(
    context.active(),
    request.headers,
    {
      get: (headers, key) => headers.get(key) ?? undefined,
      keys: (headers) => Array.from(headers.keys()),
    }
  )

  // Run in extracted context
  return context.with(parentContext, async () => {
    const tracer = otelTrace.getTracer('my-api')

    return tracer.startActiveSpan('fetchUsers', async (span) => {
      try {
        const users = await db.users.findAll()
        span.end()
        return Response.json(users)
      } catch (error) {
        span.recordException(error)
        span.end()
        throw error
      }
    })
  })
}
```

## API Reference

### `init(config)`

Initialize the browser SDK. Call once, client-side only.

```typescript
interface AutotelWebConfig {
  /** Service name for the browser application */
  service: string

  /** Enable fetch instrumentation (default: true) */
  instrumentFetch?: boolean

  /** Enable XMLHttpRequest instrumentation (default: true) */
  instrumentXHR?: boolean

  /** Enable debug logging (default: false) */
  debug?: boolean

  /** Privacy controls for traceparent header injection */
  privacy?: PrivacyConfig
}

interface PrivacyConfig {
  /** Only inject traceparent on these origins (whitelist) */
  allowedOrigins?: string[]

  /** Never inject traceparent on these origins (blacklist) */
  blockedOrigins?: string[]

  /** Respect Do Not Track browser setting */
  respectDoNotTrack?: boolean

  /** Respect Global Privacy Control signal */
  respectGPC?: boolean
}
```

**Example:**

```typescript
init({
  service: 'my-spa',
  debug: false,
  privacy: {
    allowedOrigins: ['api.myapp.com'],
    respectDoNotTrack: true
  }
})
```

### `initFull(config)` (full mode)

Initialize full browser tracing. Import from `autotel-web/full`. Call once, client-side only.

```typescript
interface AutotelWebFullConfig {
  service: string
  endpoint?: string                    // OTLP traces URL (e.g. https://api.example.com/v1/traces)
  spanProcessor?: SpanProcessor        // Custom processor instead of endpoint
  sampleRate?: number                  // 0–1, e.g. 0.1 in production
  sampler?: Sampler                    // Custom sampler (overrides sampleRate)
  captureNavigation?: boolean          // default true
  captureFetch?: boolean               // default true
  captureXHR?: boolean                 // default true
  captureNetworkTiming?: boolean       // http.client.network_timing events (default true)
  captureErrors?: boolean              // unhandled errors → span.recordException (default true)
  captureWebVitals?: boolean          // LCP, INP, CLS, FCP, TTFB as web_vitals span (default true)
  webVitals?: { reportAllChanges?: boolean }  // pass through to web-vitals (default false)
  captureLongTasks?: boolean          // long-task spans (main thread >= 50ms); opt-in (default false)
  copyHttpSpanAttributesToEvent?: boolean
  userInteraction?: { enabled: boolean; selectors?: string[] }
  privacy?: PrivacyConfig
  debug?: boolean
}
```

### `trace(fn)` and `trace(ctx => fn)`

Wrap functions with automatic tracing.

**Direct Pattern (no context access):**

```typescript
import { trace } from 'autotel-web'

export const fetchUser = trace(async (id: string) => {
  const response = await fetch(`/api/users/${id}`)
  return response.json()
})

// Usage
const user = await fetchUser('123')
```

**Factory Pattern (with context access):**

```typescript
export const fetchUser = trace(ctx => async (id: string) => {
  // ctx.traceId, ctx.spanId available (lean mode)
  const response = await fetch(`/api/users/${id}`)
  return response.json()
})

// Usage
const user = await fetchUser('123')
```

For **custom attributes and real spans** in the browser, use **full mode** (`autotel-web/full`): `setAttribute`, `addEvent`, and `span()` operate on the active OTel span.

### `span(name, fn)` (full mode only)

Create a manual span. Import from `autotel-web/full`:

```typescript
import { span } from 'autotel-web/full'

const result = await span('processData', (s) => {
  s.setAttribute('data.size', data.length)
  const out = processData(data)
  s.end()
  return out
})
```

### `setAttribute(key, value)` / `addEvent(name, attributes)` (full mode only)

Set attributes or add events on the active span. Import from `autotel-web/full`.

### `getActiveContext()`

Get the current active trace context:

```typescript
import { getActiveContext } from 'autotel-web'

const ctx = getActiveContext()
if (ctx) {
  console.log('Trace ID:', ctx.traceId)
  console.log('Span ID:', ctx.spanId)
}
```

## Privacy Controls

autotel-web includes built-in privacy controls to ensure compliance with GDPR, CCPA, and other privacy regulations. Control which origins receive `traceparent` headers and respect user privacy preferences.

### Privacy Configuration

```typescript
interface PrivacyConfig {
  /** Only inject traceparent on these origins (whitelist) */
  allowedOrigins?: string[]

  /** Never inject traceparent on these origins (blacklist) */
  blockedOrigins?: string[]

  /** Respect Do Not Track browser setting */
  respectDoNotTrack?: boolean

  /** Respect Global Privacy Control signal */
  respectGPC?: boolean
}
```

### Example: Restrict to First-Party APIs

Only inject `traceparent` on your own API endpoints:

```typescript
init({
  service: 'my-app',
  privacy: {
    allowedOrigins: ['api.myapp.com', 'myapp.com']
  }
})

// ✅ Injects traceparent
fetch('https://api.myapp.com/users')

// ❌ Does NOT inject traceparent (not in allowlist)
fetch('https://external-api.com/data')
```

### Example: Block Third-Party Analytics

Block `traceparent` injection on analytics and tracking domains:

```typescript
init({
  service: 'my-app',
  privacy: {
    blockedOrigins: [
      'analytics.google.com',
      'facebook.com',
      'mixpanel.com',
      'segment.io'
    ]
  }
})

// ✅ Injects traceparent (not blocked)
fetch('https://api.myapp.com/users')

// ❌ Does NOT inject traceparent (blocked)
fetch('https://analytics.google.com/collect')
```

### Example: Respect User Privacy Signals

Respect Do Not Track (DNT) and Global Privacy Control (GPC):

```typescript
init({
  service: 'my-app',
  privacy: {
    respectDoNotTrack: true,  // Disable tracing if user has DNT enabled
    respectGPC: true           // Disable tracing if user has GPC enabled
  }
})

// If user has DNT or GPC enabled:
// ❌ NO traceparent headers injected on ANY requests
```

### Example: Combined Privacy Rules

Combine multiple privacy controls for fine-grained control:

```typescript
init({
  service: 'my-app',
  privacy: {
    // Only inject on these origins
    allowedOrigins: ['myapp.com', 'api.myapp.com'],

    // BUT never inject on these (even if in allowlist)
    blockedOrigins: ['analytics.myapp.com'],

    // AND respect user's privacy preferences
    respectDoNotTrack: true,
    respectGPC: true
  }
})
```

### Decision Priority

Privacy checks follow this order:

1. **Do Not Track** - If enabled and `respectDoNotTrack: true`, block ALL injection
2. **Global Privacy Control** - If enabled and `respectGPC: true`, block ALL injection
3. **Blocklist** - If origin matches `blockedOrigins`, block injection
4. **Allowlist** - If `allowedOrigins` is set, ONLY allow those origins
5. **Default** - Allow injection (backward compatible)

### Origin Matching

Origins are matched using **substring matching** for flexibility:

```typescript
init({
  privacy: {
    allowedOrigins: ['myapp.com']
  }
})

// ✅ Matches (contains "myapp.com")
fetch('https://myapp.com/api')
fetch('https://api.myapp.com/users')
fetch('https://admin.myapp.com/dashboard')

// ❌ Does NOT match
fetch('https://otherapp.com/api')
```

**Case-insensitive:** Origins are normalized to lowercase before matching.

### GDPR & CCPA Compliance

When handling EU or California users, consider these configurations:

**Strict Compliance (Recommended):**
```typescript
init({
  service: 'my-app',
  privacy: {
    allowedOrigins: ['myapp.com'],        // First-party only
    respectDoNotTrack: true,               // Honor DNT
    respectGPC: true                       // Honor GPC
  }
})
```

**Balanced Approach:**
```typescript
init({
  service: 'my-app',
  privacy: {
    blockedOrigins: [
      'analytics.google.com',
      'facebook.com',
      'doubleclick.net'
    ],
    respectGPC: true  // Respect explicit privacy request
  }
})
```

### Debug Logging

Enable debug logging to see privacy decisions:

```typescript
init({
  service: 'my-app',
  debug: true,  // <-- Enable debug logging
  privacy: {
    blockedOrigins: ['analytics.google.com']
  }
})

// Console output:
// [autotel-web] Initialized successfully { service: 'my-app', privacyEnabled: true, ... }
// [autotel-web] Skipped traceparent on fetch (privacy): https://analytics.google.com/collect Origin is in blockedOrigins list
// [autotel-web] Injected traceparent on fetch: https://api.myapp.com/users 00-4bf92f...
```

### Troubleshooting Privacy Issues

**Headers not being injected when expected:**

1. Check if DNT or GPC is enabled in your browser
2. Verify origin is in `allowedOrigins` (if configured)
3. Verify origin is NOT in `blockedOrigins`
4. Enable debug logging to see decision reasons

**Headers still being injected when blocked:**

1. Ensure privacy config is passed correctly to `init()`
2. Check that `init()` was only called once (subsequent calls are ignored)
3. Verify origin matching is correct (case-insensitive substring matching)

**Testing Privacy Controls:**

```typescript
// For unit tests, you can access the privacy manager
import { getPrivacyManager } from 'autotel-web'

const manager = getPrivacyManager()
if (manager) {
  const shouldInject = manager.shouldInjectTraceparent('https://api.myapp.com')
  console.log('Should inject:', shouldInject)
}
```

**Checking Browser Privacy Settings:**

```javascript
// Check if Do Not Track is enabled
console.log('DNT:', navigator.doNotTrack) // '1' = enabled, '0' = disabled

// Check if Global Privacy Control is enabled
console.log('GPC:', navigator.globalPrivacyControl) // true/false/undefined
```

### Advanced: Custom Privacy Logic

For advanced use cases, you can import and use the `PrivacyManager` directly:

```typescript
import { PrivacyManager } from 'autotel-web/privacy'

const manager = new PrivacyManager({
  allowedOrigins: ['myapp.com'],
  respectDoNotTrack: true
})

// Check if injection should happen for a specific URL
const shouldInject = manager.shouldInjectTraceparent('https://api.myapp.com/users')
console.log('Should inject:', shouldInject)

// Get denial reason (for debugging)
import { getDenialReason } from 'autotel-web/privacy'
const reason = getDenialReason(manager, 'https://blocked.com/api')
console.log('Denial reason:', reason)
// Output: "Origin https://blocked.com is not in allowedOrigins list"
```

## Using with Other SDKs

### Sentry

autotel-web and Sentry can coexist. Both will instrument fetch/XHR.

**Recommendation:** Initialize Sentry first, then autotel-web.

```typescript
import * as Sentry from '@sentry/browser'
import { init } from 'autotel-web'

// 1. Initialize Sentry first
Sentry.init({
  dsn: 'YOUR_SENTRY_DSN',
  tracesSampleRate: 1.0,
})

// 2. Then initialize autotel-web
init({ service: 'my-app' })
```

Sentry's instrumentation typically preserves existing `traceparent` headers, so both should work together.

### Datadog RUM

Similar to Sentry, initialize Datadog RUM first:

```typescript
import { datadogRum } from '@datadog/browser-rum'
import { init } from 'autotel-web'

// 1. Initialize Datadog RUM first
datadogRum.init({
  applicationId: 'YOUR_APP_ID',
  clientToken: 'YOUR_CLIENT_TOKEN',
  site: 'datadoghq.com',
  service: 'my-app',
  sessionSampleRate: 100,
  sessionReplaySampleRate: 100,
  trackUserInteractions: true,
  trackResources: true,
  trackLongTasks: true,
})

// 2. Then initialize autotel-web
init({ service: 'my-app' })
```

### Conflicts

If you experience conflicts (e.g., duplicate instrumentation or missing headers):

**Option 1:** Choose one SDK for distributed tracing
- For full RUM (errors, session replay, performance): Use vendor SDK only
- For distributed tracing only: Use autotel-web only

**Option 2:** Disable fetch/XHR instrumentation in autotel-web:

```typescript
init({
  service: 'my-app',
  instrumentFetch: false,
  instrumentXHR: false
})
```

Then manually inject `traceparent` headers:

```typescript
import { getActiveContext } from 'autotel-web'

const ctx = getActiveContext()
if (ctx) {
  fetch('/api/data', {
    headers: {
      traceparent: `00-${ctx.traceId}-${ctx.spanId}-01`
    }
  })
}
```

## SSR Safety

autotel-web is **SSR-safe** by design. All browser APIs (WebTracerProvider, ZoneContextManager) are accessed inside `init()`, not at module load time.

### Safe: ✅

```typescript
// ✅ Safe: init() called in useEffect (client-side only)
useEffect(() => {
  init({ service: 'my-app' })
}, [])

// ✅ Safe: init() called in entry.client.tsx (Remix)
init({ service: 'my-app' })

// ✅ Safe: init() called in 'use client' component (Next.js)
'use client'
init({ service: 'my-app' })
```

### Unsafe: ❌

```typescript
// ❌ Unsafe: init() at module top-level
import { init } from 'autotel-web'
init({ service: 'my-app' })  // This runs during SSR!
export default function MyComponent() { ... }
```

## Bundle Size

- **Lean mode** (`autotel-web`): **~1.6KB gzipped**. Zero dependencies. Pure JavaScript using native `crypto.getRandomValues()`.
- **Full mode** (`autotel-web/full`): ~40–50KB gzipped (includes OpenTelemetry SDK and instrumentations). No Zone.js. Use when you need real spans and export from the browser.

## Architecture: Header-Only Approach

autotel-web takes a **minimalist approach** to browser tracing:

### What it DOES:
✅ Generates W3C `traceparent` headers (`00-{traceId}-{spanId}-01`)
✅ Automatically injects headers on fetch/XHR calls
✅ Provides a nice DX with `trace()` wrappers

### What it DOESN'T do:
❌ Create real spans in the browser
❌ Measure timing/duration
❌ Export to collectors
❌ Use OpenTelemetry SDKs

### Why?

The browser's job is **trace propagation only**. Your backend (using Autotel) receives the `traceparent` header and creates the real spans with timing, errors, and full context.

This approach:
- Keeps bundle size tiny (1.6KB vs 55KB for full OTel)
- Avoids CORS issues (no exporter endpoints)
- Eliminates Zone.js conflicts (Angular, etc.)
- Simplifies maintenance (no OTel version updates)

The backend does all the real work, which is where you want detailed telemetry anyway!

## Why Not Use OpenTelemetry in the Browser?

The official OpenTelemetry browser SDK (`@opentelemetry/sdk-trace-web`) is a **full-featured tracing implementation** with:
- Real span creation and lifecycle management
- Context propagation via Zone.js (~15KB)
- Span processors and exporters
- Automatic instrumentations
- **Result: ~55KB gzipped**

### When to Use Full OTel Browser SDK

✅ You need to **export spans directly from the browser** to a collector
✅ You need **client-side performance timing** (Core Web Vitals, resource timing)
✅ You're building a **monitoring/observability product** that requires browser-side analysis
✅ You need **detailed client-side error tracking** with full span context

### When to Use autotel-web (This Package)

✅ You only need **trace correlation** between frontend and backend → use **lean mode** (`init` from `autotel-web`)
✅ You want **real browser spans and network timing** but **one install and no Zone.js** → use **full mode** (`initFull` from `autotel-web/full`)
✅ Your backend **already exports to a collector** (OTLP, Datadog, etc.)
✅ You want **minimal bundle size impact** (~1.6KB for lean vs ~55KB for full OTel with Zone)
✅ You want to **avoid Zone.js** (conflicts with Angular, adds complexity)
✅ You prefer **zero dependencies** and simpler maintenance

**Bottom Line:** For trace correlation only, use lean mode. For real browser spans and network timing with a single install and no Zone.js, use full mode (`autotel-web/full`).

## Performance Impact

autotel-web has **effectively zero performance overhead**:

✅ **No promise wrapping** - Your async code runs unchanged
✅ **No timer patching** - setTimeout/setInterval work normally
✅ **No Zone.js** - No global async context tracking
✅ **No span objects** - No memory allocation for browser spans
✅ **Header-only** - Just adds one HTTP header per request

**What it does:**
- Patches `window.fetch` and `XMLHttpRequest.prototype.open` at initialization
- Generates a 32-byte header value using `crypto.getRandomValues()`
- Adds the header to outgoing requests

**Benchmark:**
- Header generation: ~0.01ms
- Network overhead: +45 bytes per request (traceparent header)
- Memory: ~2KB for the SDK code

**Real-world impact:** Imperceptible. The network request itself takes orders of magnitude longer than the header injection.

## Context Propagation Without Zone.js

Browser tracing with OpenTelemetry typically needs **context propagation**: when you start a span (e.g., "user clicked button"), any async work that follows—fetch, setTimeout, Promise chains—should run in that same trace context so the backend sees one continuous trace. In Node.js, OpenTelemetry uses AsyncLocalStorage to keep context across async boundaries. In the browser, there is no built-in "async context" that follows every boundary. **Zone.js** is the usual way to get that: it patches globals (setTimeout, Promise, fetch, etc.) so that any code that runs "later" still runs inside the same zone—and thus the same trace context.

This section explains when you might need Zone.js, its pitfalls, and how autotel-web gets you reliable tracing without it.

### When You Might Think You Need Zone.js

You might think you need **async context that survives every boundary** when:

- You start a span in one place (e.g., click handler) and want **all** follow-up work—nested setTimeout, microtasks, fetch callbacks, requestAnimationFrame—to stay under that span without you wrapping each boundary
- You have deep or framework-driven async (e.g., React state updates → effects → fetch → more effects) and you can't or don't want to wrap every step
- You rely on "current span" or "current trace ID" in code that runs in callbacks you don't control (e.g., third-party lib that calls your callback after a delay)

In those cases, Zone.js gives you one execution context that follows the entire async tree. OpenTelemetry can attach the active span to that zone, and every callback runs in the same context.

### Pitfalls of Zone.js

**1. Bundle size and cost**
Zone.js is on the order of ~12–15 KB minified/gzipped. For a browser SDK that aims to be small (autotel-web lean is ~1.6 KB), adding Zone significantly increases size for every user.

**2. Global patching**
Zone.js patches `setTimeout`, `setInterval`, `Promise`, `fetch`, `XHR`, `addEventListener`, and more. That can:

- Conflict with other libraries that also patch or depend on "vanilla" behavior
- Cause hard-to-debug issues in frameworks (e.g., Angular uses Zone; other frameworks don't and sometimes assume no patching)
- Break or confuse code that relies on exact timing or microtask ordering

**3. Framework and tooling friction**
Some bundlers, test runners, and frameworks have had issues with Zone (e.g., Next.js, Vite, or Jest in the past). You can end up debugging "why is my context wrong only in tests" or "why does this break in production build."

**4. Implicit behavior**
Context "just following" everywhere is convenient but implicit. When something goes wrong (wrong span, wrong trace), the cause is not obvious: it's "whatever Zone did." Explicit propagation (e.g., "this span covers this function") is easier to reason about and debug.

**5. Maintenance**
Zone.js is not part of the web platform. New APIs (e.g., new promise helpers, scheduler APIs) may need new patches. You depend on the Zone maintainers and the OpenTelemetry Zone plugin to keep up.

### How autotel-web Works Without Zone.js

autotel-web is designed so you can get **useful, reliable browser → backend tracing** without Zone.js. It does that in three ways: lean mode, full mode with targeted instrumentation, and an explicit `trace()` API.

#### 1. Lean Mode: No Real Browser Spans

In **lean mode** (`init()` from `autotel-web`), the browser does **not** create real OpenTelemetry spans. It only:

- Injects the W3C `traceparent` header on every `fetch` and XHR request

So the "context" that matters is on the **request**: the backend receives `traceparent`, continues the trace, and does all span creation and export. There is no "current span" in the browser to lose across async boundaries. You don't need Zone for this.

**Use lean mode when:** You care about distributed traces (browser → API → services) and are fine with the backend owning the spans.

#### 2. Full Mode: Instrumentation That Propagates on the Wire

In **full mode** (`initFull()` from `autotel-web/full`), the browser **does** create real spans (navigation, fetch/XHR, Web Vitals, etc.). Context can be lost across arbitrary async boundaries (e.g., `setTimeout`), but autotel-web focuses on the boundaries that matter for tracing:

- **Fetch / XHR**: The OpenTelemetry fetch and XHR instrumentations wrap the real `fetch` and `XMLHttpRequest`. When your code calls `fetch()`, the instrumentation starts a span and injects `traceparent` into the request. When the response comes back, the callback runs in the same invocation chain as the one that called `fetch`, so the span is still active and can be ended. You don't cross a "lost" boundary in the common case.
- **Document load / navigation**: Handled by the document-load instrumentation; the span covers the load and its natural async work.

So for "user did something → app called fetch → backend continued the trace," context is preserved **along the path that the instrumentation controls**. You don't need Zone for that.

**Use full mode when:** You want real browser spans (and optional Web Vitals, errors, etc.) and your critical paths are "start → fetch/XHR → done" or "navigation."

#### 3. Explicit `trace()` for Critical Paths

When you have a flow that **does** cross boundaries where context would be lost (e.g., "click → setTimeout → fetch → update UI"), you can wrap the whole logical operation in **one** `trace()`:

```typescript
import { trace } from 'autotel-web'

const handleConvert = trace(ctx => async () => {
  setLoading(true)
  await new Promise(r => setTimeout(r, 0))  // context still inside this trace()
  const res = await fetch('/api/convert', { ... })
  const data = await res.json()
  setResult(data)
  setLoading(false)
})
```

Because the entire flow is inside a single `trace()` call, the fetch call runs "under" that logical span; the fetch instrumentation will see the active context (in full mode) or at least the header injection (in lean mode) keeps the same trace ID on the request. You don't need Zone to keep context inside that one async function.

**Use explicit `trace()` when:** You have a clear "one user action → one chain of async work" and you're okay wrapping that chain once.

### Summary: Zone.js vs autotel-web

| Need | Zone.js | autotel-web approach |
|------|--------|------------------------|
| Trace from browser to backend | Not required | Lean mode: inject `traceparent`; backend continues trace. |
| Real browser spans (navigation, fetch, Web Vitals) | Not required for the common path | Full mode: instrument fetch/XHR and document load so context is preserved on the wire and in the main async chain. |
| Context across arbitrary async (setTimeout, third‑party callbacks) | Helps | Explicit `trace()` around the whole flow; or accept best-effort. |
| Small bundle, no global patching | N/A | Lean mode is ~1.6 KB; full mode avoids Zone. |
| Fewer framework/tooling issues | N/A | No Zone dependency. |

**Bottom line:** You might need Zone.js if you want "current span" to follow **every** async boundary with no explicit wrapping. autotel-web avoids Zone by: (1) not creating real browser spans in lean mode, (2) in full mode, instrumenting the boundaries that matter for tracing (fetch, XHR, load), and (3) offering an explicit `trace()` so you can wrap critical paths once. That covers most real-world needs without Zone's pitfalls.

## Examples

See the `apps/` directory at the repository root for complete working examples:

- **example-web-vanilla** - Simple HTML + script tag example showing traceparent header injection

More examples coming soon:
- React + Vite - Client-side React app
- Next.js - App Router with SSR
- Remix - Full-stack Remix app
- Vue - Vue 3 application

## Troubleshooting

### Headers not appearing

1. Check that `init()` was called:
```typescript
init({ service: 'my-app', debug: true })  // Enable debug logging
```

2. Verify in DevTools:
   - Open Network tab
   - Click on a request
   - Check "Request Headers" for `traceparent`

3. Ensure fetch/XHR instrumentation is enabled:
```typescript
init({
  service: 'my-app',
  instrumentFetch: true,  // default: true
  instrumentXHR: true,    // default: true
})
```

### Backend not receiving context

1. Check that backend is using Autotel or OpenTelemetry
2. Verify CORS headers allow `traceparent`:
```javascript
// Express CORS config
app.use(cors({
  exposedHeaders: ['traceparent', 'tracestate']
}))
```

3. For custom frameworks, manually extract context (see "Backend Integration" above)

### TypeScript errors

Ensure you're using TypeScript 5.0+ and have `@types/node` installed:

```bash
pnpm add -D typescript@^5.0.0 @types/node
```

## License

MIT © Jag Reehal

## Related Packages

- [autotel](../autotel) - Node.js OpenTelemetry SDK
- [autotel-edge](../autotel-edge) - Edge runtime SDK (Cloudflare Workers, Vercel Edge)
- [autotel-subscribers](../autotel-subscribers) - Event subscribers (PostHog, Mixpanel, etc.)

---

**Questions?** Open an issue at [github.com/jagreehal/autotel](https://github.com/jagreehal/autotel/issues)
