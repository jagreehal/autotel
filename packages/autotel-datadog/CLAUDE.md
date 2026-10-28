# autotel-datadog (Datadog RUM join)

Joins autotel-web's traces to Datadog RUM on the same page. RUM keeps errors, sessions and replays; autotel owns the tracing.

## Key concepts

- **`joinDatadog(datadogRum, options)`** returns an `enrichSpans()` processor (from `autotel-web/join`) for `initFull({ spanEnrichers })`, with a `beforeSend` hook attached for `datadogRum.init({ beforeSend })`. Two halves because RUM's `beforeSend` can only be given at init, not added later.
- **RUM's field allowlist decides the shape.** `limitModification` in `@datadog/browser-rum-core` (`domain/assembly.js`) reverts every `beforeSend` edit outside a per-event-type allowlist. For errors that is `context`, `error.message/stack/handling_stack/resource.url/fingerprint`, `view.*`, `service`, `version`. `_dd.trace_id` is **not** on it, so the native RUM→APM link cannot be set from outside; the join writes `context.trace_id` / `context.span_id` / `context.trace_url` instead. Do not write to `_dd`: it is silently discarded.
- **Id formats are Datadog's.** APM stores an OpenTelemetry trace id as the same 128-bit hex (`trace_id`), and span ids in decimal. So `context.trace_id` is hex, `context.span_id` is decimal (BigInt conversion). Checked against a live EU org.
- **Spans side.** `session` = `getInternalContext().session_id` (assigned to `session.id`, sent as baggage); `user.id` from `getUser().id` (string or number only); `session.replay.url` on failed spans from `getSessionReplayLink()`. That link is always a URL: when nothing records it carries `?error-type=rum-not-tracked|incorrect-session-plan|replay-not-started`, which the join treats as "no link" and explains.
- **Never drops an event.** `beforeSend` returns `true` always and is filled, not assigned: an app's own `context.trace_id` wins.
- **Structural type.** `DatadogRumLike` is hand-written; `index.test.ts` assigns the real `datadogRum` to it at compile time.

## Testing

- `src/index.test.ts`: the join against a fake RUM, plus the type contract.
- The runtime contract (RUM's real pipeline keeping `context`) needs a real browser: RUM configures but never starts under jsdom. `apps/example-datadog` `pnpm smoke:web` runs it in Chromium, with RUM pointed at the example server through RUM's `proxy` option when no RUM application is configured, and reads spans and Error Tracking issues back from Datadog.

## Boundaries

- Never: import `@datadog/*` values (types only, dev dependency), write to `_dd.*` in `beforeSend`, return `false` from `beforeSend`, put a replay link on a healthy span or on an `error-type` link.
