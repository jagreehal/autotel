---
name: autotel-web
description: >
  Use this skill when adding distributed tracing or RUM to a browser application — covers lean mode (traceparent header injection, ~5.4KB), full mode (real OTel spans, Web Vitals, error capture), frustration signals (dead and rage clicks), breadcrumbs, page engagement, console-to-OTLP logs, session-consistent sampling, remote capture config, privacy controls, and SSR-safe setup.
---

# autotel-web

Ultra-lightweight browser SDK for distributed tracing. Two modes:

- **Lean** (`autotel-web`): ~5.4KB gzipped. No OTel dependencies. Injects W3C `traceparent` headers on fetch/XHR so the backend can continue the trace. No real browser spans.
- **Full** (`autotel-web/full`): Real OTel spans, Web Vitals, error capture, network timing, OTLP export. Larger bundle (~40–50KB gzipped).

## Setup

### Lean mode: traceparent injection only

```typescript
import { init } from 'autotel-web';

// Call once, client-side only. SSR-safe (no-op if window is undefined).
init({ service: 'my-frontend-app' });

// All fetch/XHR calls now include traceparent headers automatically
fetch('/api/users');
```

### Full mode: real browser spans + export

```typescript
import { initFull } from 'autotel-web/full';

initFull({
  service: 'my-app',
  endpoint: 'https://collector.example.com/v1/traces', // OTLP HTTP
  sampleRate: 0.1, // 10% in production
  captureNavigation: true, // document load spans (default: true)
  captureFetch: true, // fetch instrumentation (default: true)
  captureXHR: true, // XHR instrumentation (default: true)
  captureErrors: true, // unhandled errors (default: true)
  captureWebVitals: true, // LCP, INP, CLS, FCP, TTFB (default: true)
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
  service: 'my-app', // Required. Identifies the browser service in logs.
  debug: false, // Log injection decisions to console (default: false)
  instrumentFetch: true, // Patch fetch() (default: true)
  instrumentXHR: true, // Patch XMLHttpRequest (default: true)
  privacy: {
    allowedOrigins: ['api.myapp.com'], // Only inject on these origins
    blockedOrigins: ['analytics.google.com'], // Never inject on these origins
    respectDoNotTrack: true, // Honour browser DNT header
    respectGPC: true, // Honour Global Privacy Control
  },
});
```

Privacy decision order: DNT check → GPC check → blockedOrigins → allowedOrigins → allow all.

### Functional API (lean mode)

```typescript
import {
  init,
  trace,
  getActiveContext,
  getTraceparent,
  extractContext,
} from 'autotel-web';

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
import {
  createTraceparent,
  generateTraceId,
  generateSpanId,
  parseTraceparent,
} from 'autotel-web';

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

### Canonical names (do not invent your own)

Every signal is emitted under the name OpenTelemetry owns, so any backend's
browser dashboard works unchanged. When suggesting queries or dashboards, use
these — the pre-v2 homegrown names (`click: x`, `web_vitals.lcp`, `long_task`)
are gone.

| signal       | name                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| click        | `app.widget.click` + `app.widget.name` / `.id` / `app.screen.name` / `app.screen.coordinate.x`,`.y`      |
| web vital    | `browser.web_vital` (one event per metric) + `browser.web_vital.name` / `.value` / `.rating`             |
| long task    | `app.jank` + `app.jank.threshold`, `app.jank.duration`                                                   |
| session      | `session.id`, `session.previous_id`; `session.start` / `session.end` events                              |
| browser      | `browser.language`, `.platform`, `.mobile`, `.brands` (resource attributes)                              |
| frustration  | `app.widget.click.frustration` + `app.widget.click.outcome` (`dead` \| `rage`)                           |
| engagement   | `browser.page_engagement` + `browser.page.max_scroll_percentage`, `.max_content_percentage`, `.duration` |
| feature flag | `feature_flag.*` + the `feature_flag.evaluation` event                                                   |

`src/semconv.ts` is the source of truth and is pinned by a test.
`user_agent.*` is deliberately unset — deriving it needs a real UA database and
every collector ships one.

**These are events, so they are log records, not spans.** They arrive on the
logs pipeline with the name in both `eventName` and `event.name`. Query them
where your logs are, not in trace search — and never suggest emitting one as a
zero-duration span: it is invisible to every event dashboard, and in lean mode
(no tracer provider) it produces nothing at all.

`browser.web_vital` carries `name` lower-cased (`lcp`, not `LCP`) plus `value`,
`delta` and `id`. `app.jank.period` and `app.jank.threshold` are in **seconds** —
the browser's 50ms long-task threshold is `0.05`.

### Frustration signals (dead and rage clicks)

```typescript
initFull({ service: 'my-app', endpoint: '...', captureFrustration: true });
```

The one browser signal a tracer cannot produce for itself: a click that does
nothing runs no code, so the trace is empty exactly where the user is stuck.

- `app.widget.click.outcome = 'rage'` — three clicks within 30px and a second,
  with `app.widget.click.rage_count`. One event per burst.
- `app.widget.click.outcome = 'dead'` — nothing responded, with
  `app.widget.click.verdict_signal` naming the deciding timeout.

A dead click is judged ~1s later. Liveness suppresses (DOM mutation <2500ms,
scroll <100ms, `selectionchange` <100ms, visibility/focus change within 1s
either side); only then does a timeout convict. Anchors, modifier-key clicks and
repeat clicks on one node are never candidates.

**Do not loosen the thresholds.** A "dead click" that fires on working buttons
teaches people to ignore the signal. Touch (dead swipes) is not covered.

### Breadcrumbs (what happened before the error)

```typescript
initFull({ service: 'my-app', endpoint: '...', breadcrumbs: true });

import { addBreadcrumb } from 'autotel-web';
addBreadcrumb({
  category: 'checkout',
  message: 'applied coupon',
  data: { code },
});
```

Clicks and `console.*` are captured automatically; the trail is attached to every
exception as `exception.breadcrumbs`. Bounded in **bytes** (32KB default), not
entries — one enormous crumb is not an entry-count problem. The newest is never
dropped.

### Page engagement

```typescript
initFull({ service: 'my-app', endpoint: '...', captureEngagement: true });
```

Emits `browser.page_engagement` on page hide and route change. Suggest **both**
percentages: scroll depth is how far they moved, content depth is how far down
the page was on screen. On a page shorter than the viewport nothing scrolls, so
scroll depth alone reads a fully-read page as a bounce.

### Console output as log records

```typescript
initFull({ service: 'my-app', endpoint: '...', captureConsoleLogs: true });
```

Exports `console.*` as OTLP **log records** over the same transport as spans
(so it inherits retries and the offline queue), carrying `session.id`.
Auto-captured output uses the `console` instrumentation scope. Distinct from
breadcrumbs: this feeds the log pipeline, breadcrumbs feed the error.

### Sampling keeps whole sessions

`sampleRate` hashes the session id, so a sampled session is sampled whole.
Random per-span sampling keeps a tenth of _every_ session and leaves none of
them reconstructable — never suggest replacing this with `Math.random()`.
Monotonic in the rate: raising it mid-incident only adds sessions.

### Remote capture config

```typescript
initFull({
  service: 'my-app',
  endpoint: '...',
  remoteConfigUrl: '/autotel.json',
});
```

A JSON file at a URL the app already serves, controlling `sampleRate`,
`captureDeadClicks`, `captureRageClicks`, `captureEngagement` and
`errorSuppression`. Cached and applied **synchronously** on the next visit; a
failed fetch changes nothing. Only known keys with valid values survive parsing.

Two merge rules, deliberately different. Capture toggles let remote win **both**
ways — it can turn a signal on the app left off, which is half the reason remote
config exists. Suppression rules are **additive only**: a fetched file must not
be able to switch off error reporting the app asked for.

### Full mode: advanced options

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
  captureFrustration: true, // dead + rage clicks
  captureEngagement: true, // scroll / content depth
  breadcrumbs: true, // trail attached to exceptions
  captureConsoleLogs: true, // console.* as OTLP log records
  sampleRate: 0.1, // hashed on session id, not per span
  remoteConfigUrl: '/autotel.json',
});
```

### Backend (autotel): automatic trace continuation

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

### HIGH: Calling init() in SSR/server code

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

### HIGH: Importing from autotel-web/full for lean use case

Wrong:

```typescript
import { initFull } from 'autotel-web/full'; // pulls in all OTel SDK packages (~40-50KB)
initFull({ service: 'my-app' }); // when you only need header propagation
```

Correct:

```typescript
import { init } from 'autotel-web'; // ~5.4KB gzipped, zero OTel dependencies
init({ service: 'my-app' });
```

Explanation: Full mode bundles the OpenTelemetry browser SDK. Use it only when you need real browser spans, Web Vitals, or OTLP export from the client.

### HIGH: Using protocol:// in allowedOrigins / blockedOrigins

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

### MEDIUM: Expecting trace() to create real browser spans

Wrong:

```typescript
// Expecting timing data to appear in the browser's trace
const result = await trace(async () => heavyWork())();
// No browser span is created — trace() is a no-op wrapper in lean mode
```

Correct: Use full mode (`autotel-web/full`) if you need real browser spans. In lean mode, only the backend creates spans; `trace()` is provided for API consistency and access to trace IDs via the factory pattern.

### MEDIUM: Calling init() multiple times

Wrong:

```typescript
// Called in two different components
init({ service: 'my-app' });
init({ service: 'my-app' }); // second call is silently ignored
```

Correct: Call `init()` once at app startup. Subsequent calls are no-ops (with a warning logged if `debug: true`). The module-level `isInitialized` flag prevents double-patching.

### MEDIUM: Assuming a failed export is lost

Wrong: adding a second delivery path because "spans get dropped on flaky
networks".

Correct: the exporter already retries with jittered backoff, queues while
offline, caps at 1000 spans, and uses `sendBeacon` only on unload (it reports no
outcome, so there is nothing to retry against). A request that dies before any
HTTP status while the browser is online is treated as **blocked**, not broken —
that is an ad blocker or CORS — and after three the exporter waits for an
`online` event rather than retrying something that will never work.
`pendingSpanCount()` / `pendingLogCount()` expose the backlog.

## Version

Targets autotel-web v1.11.0. Lean mode has no `@opentelemetry/*` runtime dependencies. Full mode (`autotel-web/full`) depends on `@opentelemetry/sdk-trace-web`, `@opentelemetry/exporter-trace-otlp-http`, and related packages (all bundled in the package, no separate install needed). Node.js 22+ for testing; browser targets all modern browsers.
