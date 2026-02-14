# Changelog

## 0.1.0

- Initial release: Playwright fixture that creates one OTel span per test and injects W3C trace context into requests matching `API_BASE_URL` / `AUTOTEL_PLAYWRIGHT_API_ORIGIN`. Exports `test`, `expect`, `createGlobalSetup`, and `AUTOTEL_ATTRIBUTE_ANNOTATION`.

## Unreleased

- **requestWithTrace** fixture: optional fixture that wraps the built-in `request` (APIRequestContext). Requests made with `requestWithTrace.get()`, `.post()`, etc. to URLs matching the API base get trace context and `x-test-name` injected, so Node-side API calls from tests attach to the same test span.
- **step(name, fn)** helper: runs an async function as a named step and creates a child span (`step:${name}`) under the test span for step-level granularity in the same trace.
- **OtelReporter** (`autotel-playwright/reporter`): optional Playwright reporter that creates one span per test and one per step (as children) in the runner process. Use with `reporter: [['list'], [OtelReporter]]` and ensure `init()` is called in globalSetup.
