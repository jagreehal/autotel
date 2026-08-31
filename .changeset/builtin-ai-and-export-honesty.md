---
'autotel-builtin-ai': minor
'autotel': minor
'autotel-web': patch
'autotel-backends': patch
---

Trace Chrome's built-in AI APIs, stop exporting to collectors nobody
configured, and fix four ways browser telemetry went missing.

## New package: autotel-builtin-ai

OpenTelemetry instrumentation for
[Chrome's built-in AI APIs](https://developer.chrome.com/docs/ai/built-in).
Traces `availability()`, `create()` and every session method across all eight
built-in AI globals, and records the facts the platform does not keep:

- **Whether an availability guard was passed the options it was guarding.**
  `availability()` answers for the options you hand it, not for model readiness,
  so `availability() !== 'available'` — the guard Chrome's own docs show —
  refuses on browsers where the call would have worked.
- **How long `create()` blocked on a model download.** 190,163 ms measured,
  against 1–3 ms warm.
- **Whether a download monitor firing meant a download happened.** It fires
  either way, so a progress bar flashes 0→100 for returning visitors.
- **Time to first token** on streaming calls, which exists only while the stream
  is running.
- **Whether a session could report its own sampling mode.** `samplingMode` reads
  back `null` when `topK` or `temperature` was used.

Two entry points, matching `autotel-webmcp`: the default wires autotel-web's
`span()` in, and `autotel-builtin-ai/core` takes your own span factory with no
telemetry dependency. Payload capture is off by default.

## No endpoint means no export

With no endpoint from `init()`, YAML or `OTEL_EXPORTER_OTLP_ENDPOINT`, autotel
now exports nothing. The Node SDK's default is the opposite: leave the processor
lists unset and it installs its own OTLP exporter aimed at
`http://localhost:4318`, so "no endpoint configured" quietly became "export to
localhost" — a doomed request per batch, forever, with no error naming the
cause. Autotel passes empty processor lists for **both traces and logs**
instead. `OTEL_LOGS_EXPORTER` is still left to govern itself, because that is
the specification's own switch.

Not exporting and not tracing are different things, so a `TracerProvider` is
still registered when there is nothing to export. Without one nothing records,
`traceparent` stops being injected, and a service with no endpoint of its own
can no longer pass the trace to the next one.

A caller's explicit `spanProcessors: []` is a real off switch too; empty and
absent used to be indistinguishable.

## Canonical log lines to a logger and OTLP at once

`canonicalLogLines.logger` now takes an array, and the new `canonicalLogLines.otel`
sends the same wide line through the OpenTelemetry Logs API alongside it — so a
platform's own log view keeps the lines while OTLP carries them to Loki or
another backend. It defaults to `true` only when no `logger` is given, which is
the previous either/or behaviour. Setting `otel: true` also wires the endpoint's
log exporter, unless `logs: false` says otherwise; without that the lines went
to a no-op provider and never arrived. A failing logger no longer stops the
others from receiving the line.

## autotel-backends

`createGrafanaConfig()` no longer doubles the signal path when the endpoint you
paste already ends in `/v1/traces` — traces went to `/otlp/v1/traces/v1/traces`
while logs, built from the stripped base, arrived correctly.

Every preset that selects a non-default `protocol` now names the optional peer
dependency it needs, in the JSDoc and in the error thrown when it is missing.
Bundlers do not follow the lazy `require` that loads those exporters, so they
have to be direct dependencies of the application — and the failure otherwise
surfaces at `init()`, which in a serverless app means the first traced request
in production.

## autotel-web fixes

- **`endpoint: ''`** is honoured as the documented same-origin configuration
  again, rather than read as "no endpoint". It was disabling every export in
  lean mode: spans, logs and events, silently.
- **Full mode beacons on the way out**, as lean mode already did. Events and
  console logs sit in a 2-second batch and a page being navigated away from has
  no next tick, so the end of every visit — `session.end` included — was exactly
  the part that never arrived.
- **A partial remote frustration override no longer disables the other
  detector.** Remote `{ captureDeadClicks: false }` stopped rage clicks too,
  even though their remote value was absent and documented to leave the local
  setting alone.
- **A failed model stream is recorded as a failure.** The source erroring left
  the span either successful or open forever, while the caller saw a broken
  stream.
- **`debug` plus `captureConsoleLogs` no longer loops.** The exporter narrates
  each flush on the console, and exporting its own narration queued the record
  that caused the next flush, for as long as the page was open.
