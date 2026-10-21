---
'autotel': patch
'autotel-cli': patch
'autotel-effect': major
'autotel-posthog': patch
'autotel-adapters': patch
'autotel-aws': patch
'autotel-cloudflare': patch
'autotel-devtools': patch
'autotel-eventcatalog': patch
'autotel-playwright': patch
'autotel-plugins': patch
'autotel-skybridge': patch
'autotel-tanstack': patch
'autotel-terminal': patch
'autotel-vitest': patch
---

**autotel**

- `ignoreRoutes` judges the path as well when the resolved route is a catch-all (`[...slug]`, `[[...slug]]`, `*`, `:name+`), so a Hono app served from a Next.js catch-all can ignore `/api/health`.
- `ignoreRoutes` judges a raw path only as sent. A path with dot segments, `//`, a backslash, a control character or an encoded separator keeps its span.
- MongoDB query redaction replaces a call such as `ObjectId("…")` or `ISODate("…")` whole.
- `import('autotel')` works under `node -e` and the REPL, and in a bundle esbuild converts to CommonJS.

**autotel-cli**

- `autotel map` reports Hono routes registered without a leading slash (`path: ''`, `'items'`, `` `${BASE}/x` ``) at the path Hono serves them on.

**autotel-effect**

- Removed `withAutotel()`. From effect 4.0.5, the new minimum, an `Effect.runPromise` inside an autotel span joins that span's trace. Replace `Effect.runPromise(withAutotel(program))` with `Effect.runPromise(program)`.

**autotel-posthog**

- `autotelBeforeSend()` uses PostHog's own `CaptureResult` type and stays assignable to `before_send` on posthog-js 1.438.12.

**All packages**

- Peer and dependency ranges move to the latest releases of TanStack Start, Next.js, h3, the AWS SDK, PostHog, Playwright, Vitest and the AI SDK.
