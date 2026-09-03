# autotel-web

Browser SDK: W3C trace propagation, real browser spans, and the RUM signals a
tracing backend cannot derive for itself.

## Your Role

You own the browser half of autotel. You understand the OpenTelemetry browser
and `app.*` semantic conventions, the difference between what a page can observe
and what it can only infer, and why a 2KB bundle budget is a design constraint
rather than a nice-to-have.

## Two modes

- **Lean** (`autotel-web`, `src/init.ts`): no `@opentelemetry/*` runtime
  dependency. Patches `fetch`/XHR for `traceparent` + `baggage`, and hand-rolls
  OTLP/JSON export in `src/span-exporter.ts`.
- **Full** (`autotel-web/full`, `src/full.ts`): the real Web SDK, with the
  instrumentations wired in. Everything that needs a tracer lives here.

## What lives here

- `src/semconv.ts`: **source of truth** for every name this package emits, and
  pinned by `semconv.test.ts`. A typo in one of these strings is invisible at
  runtime and silently empties someone's dashboard panel. Canonical sets
  (`BROWSER`, `USER_AGENT`, `APP`, `SESSION`, `WEB_EVENT`) are the
  specification's; `AUTOTEL_WEB` holds extensions, each of which **must** extend
  a canonical event name (`browser.web_vital.value`, `app.widget.click.outcome`)
  rather than open a namespace, so spec and extension stay distinguishable and a
  future spec field can take over without a rename.
- `src/emit-event.ts`: the one seam every browser event goes through. Injected
  sink, no-op without one.
- `src/user-interaction.ts`, `src/web-vitals.ts`, `src/long-tasks.ts`: clicks,
  vitals and jank as `app.widget.click`, `browser.web_vital` (one event per
  metric, carrying `name` lower-cased plus `value`, `delta` and `id` — without
  the last two, repeat reports under `reportAllChanges` cannot be deduplicated
  or differenced) and `app.jank` (period and threshold in seconds;
  `frame_count` is omitted because a long-task entry does not report frames).
- `src/session.ts`: `session.id` / `session.previous_id`, plus optional
  `session.start` / `session.end`. A session another SDK owns (`id` provider)
  emits no lifecycle events — claiming it began when we first asked is a guess.
- `src/browser-context.ts`: `browser.*` resource attributes, plus
  `user_agent.synthetic.type: 'test'` when `navigator.webdriver` is set — the
  platform states that outright, so no inference is involved, and it keeps
  automated sessions separable from people's. The rest of `user_agent.*` is
  deliberately unset: deriving it needs a real UA database, every collector
  ships one, and a regex shipped to every visitor is wrong in a way nobody can
  fix without a release.
- `src/frustration.ts`: dead clicks and rage clicks as
  `app.widget.click.frustration`. **The thresholds are the design.** Liveness
  suppresses (mutation <2500ms, scroll <100ms, `selectionchange` <100ms,
  visibility/focus within 1s _either side_ — both sides, because a click that
  opens a tab may only surface as this window blurring, and one that hides the
  tab suspends the check timer); only then does a timeout convict. Anchors,
  modifier keys and repeat clicks never become candidates. Loosening any of this
  produces a "dead click" on working buttons, which teaches people to ignore the
  signal. Dead swipes (touch) are out of scope.
- `src/breadcrumbs.ts`: byte-bounded trail attached to exceptions as
  `exception.breadcrumbs`. Bounded in **bytes**, not entries — one enormous crumb
  is not an entry-count problem — and the newest is never dropped, since it is
  the one nearest the error.
- `src/engagement.ts`: `browser.page_engagement` with scroll depth **and**
  content depth. The initial measurement of a new route is deferred a tick: at
  the instant a route changes the page is still scrolled where the last one left
  it, and crediting the new page with the old page's depth is the bug this
  avoids.
- `src/browser-logs.ts`: `console.*` as OTLP log records. Always calls through
  to the real console **first** — a telemetry failure must never be why a
  developer's `console.log` did not appear.
- `src/sampling.ts` + `src/sampler.ts`: FNV-1a over `session.id`. Monotonic in
  the rate, so raising it mid-incident only ever adds sessions.
- `src/remote-config.ts`: capture settings from a JSON file at a URL the app
  already serves. Untrusted input — only known keys with valid values survive.
  Two merge rules, deliberately different: `resolveCaptureToggles` lets remote
  win **both** ways (a toggle that can only say "off" is not a control), while
  `applyRemoteSuppression` is additive only, because there the failure mode is
  silently losing errors the application asked to see.
- `src/span-exporter.ts`: two independent signal queues (traces, logs) sharing
  one blocked-request count, because that describes the network rather than the
  payload.

## Invariants

- **Events are log records, not spans.** Everything in `WEB_EVENT` goes through
  `emitEvent` (`src/emit-event.ts`) to an OTLP log record. A zero-duration span
  is invisible to log and event dashboards and is noise in trace search, and it
  produces nothing at all in lean mode, which has no tracer provider. The sink
  is injected rather than imported because the emitting modules are read _by_
  the exporter; importing it back would make the cycle real.
- **Full mode borrows only the log half** of `span-exporter`
  (`signals: ['logs']`). Enabling traces there would export every span twice,
  once through the Web SDK and once through the hand-rolled transport.
- **Units follow the convention.** `app.jank.period` and `app.jank.threshold`
  are documented **in seconds**; the browser's 50ms long-task threshold is
  `0.05`, never `50`. Check the JSDoc in `@opentelemetry/semantic-conventions`
  before recording any duration.
- **Canonical names only.** Every name comes from `src/semconv.ts`. Never
  reintroduce `click: x`, `web_vitals.*`, `long_task` or `feature_flag.<key>`.
- **Session-consistent sampling.** Never replace the session hash with per-span
  `Math.random()`: it keeps a tenth of every session and leaves none of them
  reconstructable, which is the opposite of what sampling is for.
- **`sendBeacon` only on unload.** It reports no outcome, so there is nothing to
  retry against. While the page is alive, `fetch` earns its extra bytes with a
  status code.
- **A responseless failure is blocked, not broken.** A request that dies before
  any HTTP status while the browser is online is an ad blocker or CORS. Retrying
  it forever burns battery; after three the exporter waits for `online`.
- **Never emit from inside unsettled state.** `getSessionAttributes` settles and
  persists the new session _before_ announcing the old one, and guards against
  re-entry, because the real sink stamps `session.id` on the record it is
  writing and therefore re-enters this module. Emitting first rolled the same
  expired session over for as long as the stack held. A test double that does
  not read the session back cannot catch this — write one that does.
- **A custom `sampler` replaces `sampleRate` for every signal, not just spans.**
  Honouring both splits them: an always-on sampler with `sampleRate: 0` would
  export spans and silently drop every event. A span sampler cannot be asked
  about a log record, so events go unsampled and the JSDoc says so.
- **Sampling stays consistent without a session.** With `session: false` the
  exporter hashes a private page-scoped key, minted once and never exported. A
  per-record coin flip keeps fragments of every page instead of a share of whole
  ones, which is the failure session-consistent sampling exists to avoid.
- **Sampling covers every signal, and is wired at both entry points.**
  `sampleRate` reaches spans, logs and events through the exporter, hashed on
  the same `session.id`. With `session: false` there is no key to be consistent
  about, so the draw is per record — never "keep everything", which makes the
  setting silently inert. Test this _through_ `init`/`initFull`: a test that
  calls `configureExporter` by hand cannot see an entry point that forgets to
  pass the rate.
- **Ambient enrichment loses to explicit attributes.** The exporter stamps
  `session.id` on every record, so it must be spread _before_ the caller's own
  attributes. Spread after, it overwrote the id on `session.end` with the
  session that had just started — inverting the one fact that event exists to
  state.
- **Nothing is dropped before it is delivered.** `sendBeacon` returns `false`
  when it refuses a payload; clear the queue only when it returns `true`.
  Retry exhaustion discards the exhausted batch alone — a batch under retry is
  sent on its own and never merged with the records queued behind it, or one
  bad payload takes the whole visit with it. The unload beacon carries
  `retryBatch` as well as `pending`: the retry timer will never fire again once
  the page is gone.
- **Instrumentation never throws into the app.** Console patches, breadcrumbs
  and log records swallow their own failures.
- **Lean mode stays dependency-free.** No `@opentelemetry/*` import may reach
  `src/init.ts` or anything it pulls in.
- **SSR-safe.** Every entry point checks for `window`/`document` first.

## Commands

```bash
pnpm --filter autotel-web build
pnpm --filter autotel-web test
pnpm --filter autotel-web type-check
pnpm --filter autotel-web lint
```

Tests that need a DOM start with `// @vitest-environment jsdom`; the default
environment is `node`. `src/test-tracer.ts` is a helper, not a suite — its name
is outside vitest's collection glob on purpose.

## Boundaries

- ✅ **Always**: add new names to `src/semconv.ts` first and pin them in
  `semconv.test.ts`; keep instrumentations independently switchable; return a
  teardown from anything that patches a global.
- ⚠️ **Ask first**: new runtime dependencies (the bundle budget is the product),
  changing frustration thresholds, new subpath exports.
- 🚫 **Never**: emit a homegrown name where a canonical one exists, derive
  `user_agent.*` in the browser, add a second delivery path, or let a full-mode
  import leak into the lean entry.
