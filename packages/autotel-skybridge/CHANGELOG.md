# autotel-skybridge

## 0.1.4

### Patch Changes

- 615995a: **autotel**

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

- Updated dependencies [615995a]
  - autotel@8.4.1
  - autotel-mcp-instrumentation@59.3.1

## 0.1.3

### Patch Changes

- eab108d: Update dependencies to their latest releases.
- Updated dependencies [eab108d]
  - autotel@8.2.2
  - autotel-mcp-instrumentation@59.3.1

## 0.1.2

### Patch Changes

- Updated dependencies [e01b63f]
  - autotel-mcp-instrumentation@59.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [62394b8]
  - autotel-mcp-instrumentation@59.2.0

## 0.1.0

### Minor Changes

- 0472a97: Add `autotel-skybridge`. `skybridgeTracing()` traces tool calls, resource reads and prompts in Skybridge MCP Apps, parents each span to the caller's `_meta` trace context, and puts the original exception and structured error fields on the span.

  `autotel-mcp-instrumentation` exports `traceMcpHandler()` for frameworks with a request hook. An `isError` tool span carries the failure text as its status message. The duration metric keeps client-supplied names out: a request the SDK rejects takes the bare method name, and resource URIs stay on the span.

  `autotel` treats a span with a remote parent as a root for `flushOnRootSpanEnd` and `forceFlushOnShutdown`, so a serverless server exports the spans of each request. When an operation sets an `ERROR` status and returns, `trace()` records `operation.success: false` and `error: true`, and metrics and tail sampling count it as failed.

### Patch Changes

- Updated dependencies [0472a97]
  - autotel-mcp-instrumentation@59.1.0
  - autotel@7.10.1
