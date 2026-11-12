---
'autotel': minor
'autotel-effect': minor
'autotel-posthog': minor
---

Server events and spans join the visitor's PostHog session.

- `autotel`: `track()` copies baggage allowed by `events.enrichFromBaggage`, as `Event` does.
- `autotel-posthog`: `PostHogSubscriber` sends `session.id` as `$session_id`. An event with no user id goes out personless under its session id, or a fresh UUID, so userless events keep separate profiles. `captureException()` without a `distinctId` does the same. Trace and session ids in their exact shape skip value-pattern redaction; `redactPaths` covers every field.
- `autotel-effect`: `webHandler` wraps `HttpRouter.toWebHandler` for Vercel and Lambda. It activates the request's baggage from the server span down, gives handlers `WaitUntil` for work after the response, and flushes spans through the platform's `waitUntil`, or before returning on Lambda. `baggageMiddleware` does the baggage half for `HttpRouter.serve`, and `runtime()` builds a `ManagedRuntime` for effects started from Promise-based callbacks.
