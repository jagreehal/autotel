---
'autotel-playwright': minor
'autotel-devtools': minor
'autotel': minor
---

Browser spans in Playwright tests, and readback helpers.

- autotel-playwright records each page request as a CLIENT span under the test span, timed from Playwright's request timing. Console errors and warnings, and uncaught page errors, become log records through the Logs API, correlated to the test span, with an `otel-logs` annotation on the test. `otelBrowserSpans: false` turns it off.
- It adds an `otel-trace-id` annotation, nests `step()` spans under the test span, and includes every span it starts in the `otel-spans` annotation.
- `autotel-devtools/testing` adds `waitForSpan`, `findSpans`, `fetchSpans` and `clearTraces` over the receiver's readback. `waitForSpan` holds every request to its deadline; both helpers take a caller's `signal`. `GET /v1/logs` returns the logs the receiver holds.
- `serializeSpan` keeps span events and `kind`; `autotel` re-exports the OpenTelemetry `logs` API.
