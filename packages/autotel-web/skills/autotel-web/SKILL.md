---
name: autotel-web
description: >
  Use this skill when adding distributed tracing to a browser application — covers lean mode (traceparent header injection, ~1.6KB), full mode (real OTel spans, Web Vitals, error capture), privacy controls, and SSR-safe setup.
type: integration
library: autotel-web
library_version: "1.11.0"
sources:
  - jagreehal/autotel:packages/autotel-web/src/index.ts
  - jagreehal/autotel:packages/autotel-web/src/init.ts
  - jagreehal/autotel:packages/autotel-web/src/functional.ts
  - jagreehal/autotel:packages/autotel-web/src/privacy.ts
  - jagreehal/autotel:packages/autotel-web/src/full.ts
---

# autotel-web

Ultra-lightweight browser SDK for distributed tracing. Two modes:

- **Lean** (`autotel-web`) — ~1.6KB gzipped. No OTel dependencies. Injects W3C `traceparent` headers on fetch/XHR so the backend can continue the trace. No real browser spans.
- **Full** (`autotel-web/full`) — Real OTel spans, Web Vitals, error capture, network timing, OTLP export. Larger bundle (~40–50KB gzipped).

## Setup

### Lean mode — traceparent injection only

```typescript
import { init } from 'autotel-web';

// Call once, client-side only. SSR-safe (no-op if window is undefined).
init({ service: 'my-frontend-app' });

// All fetch/XHR calls now include traceparent headers automatically
fetch('/api/users');
```

### Full mode — real browser spans + export

```typescript
import { initFull } from 'autotel-web/full';

initFull({
  service: 'my-app',
  endpoint: 'https://collector.example.com/v1/traces', // OTLP HTTP
  sampleRate: 0.1,        // 10% in production
  captureNavigation: true, // document load spans (default: true)
  captureFetch: true,      // fetch instrumentation (default: true)
  captureXHR: true,        // XHR instrumentation (default: true)
  captureErrors: true,     // unhandled errors (default: true)
  captureWebVitals: true,  // LCP, INP, CLS, FCP, TTFB (default: true)
  captureLongTasks: false, // main thread blocking tasks (default: false, opt-in)
});
```

### React / Next.js (client-only init)

```typescript
// app/layout.tsx or _app.tsx
import { useEffect } from 'react';
import { init } from 'autotel-web';

function App() {
  useEffect(() => {
    init({ service: 'my-spa' });
  }, []);
  return <div>...</div>;
}
```

## Configuration / Core Patterns

### AutotelWebConfig (lean mode)

```typescript
init({
  service: 'my-app',          // Required. Identifies the browser service in logs.
  debug: false,                // Log injection decisions to console (default: false)
  instrumentFetch: true,       // Patch fetch() (default: true)
  instrumentXHR: true,         // Patch XMLHttpRequest (default: true)
  privacy: {
    allowedOrigins: ['api.myapp.com'],       // Only inject on these origins
    blockedOrigins: ['analytics.google.com'], // Never inject on these origins
    respectDoNotTrack: true,                  // Honour browser DNT header
    respectGPC: true,                         // Honour Global Privacy Control
  },
});
```

Privacy decision order: DNT check → GPC check → blockedOrigins → allowedOrigins → allow all.

### Functional API (lean mode)

```typescript
import { init, trace, getActiveContext, getTraceparent, extractContext } from 'autotel-web';

init({ service: 'my-app' });

// trace() is a DX wrapper — does NOT create real browser spans
// Headers are auto-injected by init(); trace() is optional
const fetchUser = trace(async (id: string) => {
  const res = await fetch(`/api/users/${id}`);
  return res.json();
});

// Factory pattern: access trace IDs
const fetchUser = trace((ctx) => async (id: string) => {
  console.log('Trace ID:', ctx.traceId);
  const res = await fetch(`/api/users/${id}`);
  return res.json();
});

// Manual header injection (when instrumentFetch: false)
init({ service: 'my-app', instrumentFetch: false });
fetch('/api/data', {
  headers: { traceparent: getTraceparent() },
});

// SSR: extract context from incoming traceparent to continue a server trace
const ctx = extractContext(request.headers.get('traceparent') ?? '');
```

### Low-level traceparent utilities

```typescript
import { createTraceparent, generateTraceId, generateSpanId, parseTraceparent } from 'autotel-web';

const header = createTraceparent(); // e.g. "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
const parsed = parseTraceparent(header);
// { version: '00', traceId: '...', spanId: '...', flags: '01' }
```

### Full mode extras

```typescript
import { initFull, span, setAttribute, addEvent } from 'autotel-web/full';

initFull({ service: 'my-app', endpoint: '...' });

// Create a manual span
const result = span('my-operation', (s) => {
  s.setAttribute('key', 'value');
  return doWork();
  // s.end() is called automatically
});

// Add attribute or event to the currently active span
setAttribute('user.id', '123');
addEvent('button.clicked', { 'button.name': 'submit' });
```

### Full mode — advanced options

```typescript
initFull({
  service: 'my-app',
  endpoint: '...',
  userInteraction: {
    enabled: true,
    selectors: ['button', 'a', '[data-track]'], // default: ['button', 'a']
  },
  attributeRedactor: 'default', // 'default' | 'strict' | 'pci-dss' | custom config
  errorTracking: {
    // rate limiting, suppression, etc. (Omit<ErrorTrackingConfig, 'debug'>)
  },
  webVitals: {
    reportAllChanges: false, // default false for stability
  },
});
```

### Backend (autotel) — automatic trace continuation

No code changes needed on the backend. Autotel's HTTP middleware reads the `traceparent` header and creates child spans automatically:

```typescript
// Express + autotel
import { init, trace } from 'autotel';

init({ service: 'my-api', endpoint: 'http://localhost:4318' });

app.get('/api/users', async (req, res) => {
  // traceparent extracted automatically from req.headers
  const users = await trace(async () => db.users.findAll())();
  res.json(users);
});
```

## Common Mistakes

### HIGH — Calling init() in SSR/server code

Wrong:
```typescript
// pages/_app.tsx (Next.js) — runs on server too
import { init } from 'autotel-web';
init({ service: 'my-app' }); // throws on server (no window)
```

Correct:
```typescript
useEffect(() => {
  init({ service: 'my-app' });
}, []);
// Or: init() is SSR-safe (checks for window) but side effects still run server-side
// Wrap in useEffect or a client-only boundary to be safe
```

Explanation: `init()` checks `typeof window === 'undefined'` and no-ops on the server, but calling it at module level in SSR frameworks can still cause issues. Always initialize inside `useEffect` or a client component.

### HIGH — Importing from autotel-web/full for lean use case

Wrong:
```typescript
import { initFull } from 'autotel-web/full'; // pulls in all OTel SDK packages (~40-50KB)
initFull({ service: 'my-app' }); // when you only need header propagation
```

Correct:
```typescript
import { init } from 'autotel-web'; // ~1.6KB gzipped, zero OTel dependencies
init({ service: 'my-app' });
```

Explanation: Full mode bundles the OpenTelemetry browser SDK. Use it only when you need real browser spans, Web Vitals, or OTLP export from the client.

### HIGH — Using protocol:// in allowedOrigins / blockedOrigins

Wrong:
```typescript
init({
  service: 'my-app',
  privacy: {
    allowedOrigins: ['https://api.myapp.com'], // includes protocol
  },
});
```

Correct:
```typescript
init({
  service: 'my-app',
  privacy: {
    allowedOrigins: ['api.myapp.com'], // domain only (substring match)
  },
});
```

Explanation: Origin matching is substring-based. Including `https://` is unnecessary and triggers a console warning. Use domain names only.

### MEDIUM — Expecting trace() to create real browser spans

Wrong:
```typescript
// Expecting timing data to appear in the browser's trace
const result = await trace(async () => heavyWork())();
// No browser span is created — trace() is a no-op wrapper in lean mode
```

Correct: Use full mode (`autotel-web/full`) if you need real browser spans. In lean mode, only the backend creates spans; `trace()` is provided for API consistency and access to trace IDs via the factory pattern.

### MEDIUM — Calling init() multiple times

Wrong:
```typescript
// Called in two different components
init({ service: 'my-app' });
init({ service: 'my-app' }); // second call is silently ignored
```

Correct: Call `init()` once at app startup. Subsequent calls are no-ops (with a warning logged if `debug: true`). The module-level `isInitialized` flag prevents double-patching.

## Version

Targets autotel-web v1.11.0. Lean mode has no `@opentelemetry/*` runtime dependencies. Full mode (`autotel-web/full`) depends on `@opentelemetry/sdk-trace-web`, `@opentelemetry/exporter-trace-otlp-http`, and related packages (all bundled in the package, no separate install needed). Node.js 22+ for testing; browser targets all modern browsers.
