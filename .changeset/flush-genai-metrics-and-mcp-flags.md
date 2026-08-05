---
'autotel': minor
'autotel-genai': minor
'autotel-mcp': minor
---

Keep telemetry that used to disappear on the way out: flush when a process finishes, drain subscribers, record the GenAI metrics, and read the MCP server's own flags.

## `autotel`: flush when the process finishes on its own

`processHandlers` covers a process that is stopped or that crashes. Neither fires when a script runs to completion: Node drains the event loop and exits, and everything the batch span processor is still holding goes with it. No error, no warning, no spans.

That is the default shape of a CLI, a cron job, a CI step, a migration and a seed script. It is also how the failure presents: `trace()` records the span, `debug: true` prints it to the console, and the collector stays empty, so the console argues the export worked.

Autotel now listens for `beforeExit` and flushes there:

```ts
init({ service: 'my-cli' });
await doWork();
// event loop drains -> flush -> exit. No shutdown() call needed.
```

Set `flushOnExit: false` if your process manages its own exit and you would rather autotel added no listener.

Notes:

- A flush, never a shutdown. `beforeExit` fires on any event-loop drain, not only the last one, so the SDK, the process handlers and the tracer provider stay in place: a process that goes on to do more work keeps its telemetry. Subscribers are drained, since they buffer independently of our queue and are the reason a short-lived process loses events on the way out.
- One listener, however many times `init()` runs, and one flush however many times Node re-emits `beforeExit`.
- Bounded by `processHandlers.shutdownTimeoutMs` (default 2s), and the bound is an exit. An exporter that accepts the connection and never answers holds a ref'd socket, so a timeout that only settles a promise would leave the CLI waiting out the exporter's own retry schedule.
- A signal landing mid-flush queues behind it rather than tearing down the queues it is draining.
- `beforeExit` does not fire on `process.exit()`, on a signal, or after an uncaught exception. Those remain the job of `processHandlers`, and serverless still wants an explicit `flush()`.

## `autotel`: subscribers now get shut down

`EventQueue.shutdown()` drained its own queue into the subscribers and stopped there. It never called `subscriber.shutdown()`, which the `EventSubscriber` interface documents as the place a subscriber flushes its buffer.

Subscribers batch too. `LokiSubscriber` holds up to 100 events on a 5 second timer, so a process that exits before that timer fires loses whatever is in the buffer, silently. That is every Lambda, CLI, cron job and script: the exact shape of process that calls `shutdown()` and exits.

Each subscriber's `shutdown()` is now called after the queue drains, isolated so one failure cannot strand the others. A subscriber that fails to drain is logged and marked unhealthy, because that failure is the data loss this call exists to prevent.

That call is terminal for the client a subscriber wraps, while the queue is not: `shutdown()` resets it, and the next `track()` builds a fresh queue from the same config. A rebuilt queue therefore drops a subscriber it has already shut down and says so, rather than accepting events into a closed client.

## `autotel-genai`: metrics and `error.type` from `traceGenAI`

`traceGenAI` wrote rich `gen_ai.*` spans and left the metric instruments to you. `genAiMetricViews()` supplied bucket advice for instruments the package never created, so a service using autotel alone got no GenAI metrics at all.

It now records the canonical instruments on every completed operation:

- `gen_ai.client.operation.duration`
- `gen_ai.client.token.usage`, split by `gen_ai.token.type`
- `gen_ai.client.operation.time_to_first_chunk`
- `gen_ai.client.cost.usd` (an autotel extension; the spec publishes no cost metric)

The values come from what the handler already wrote to the span — through the injected `ctx` or through `getActiveTraceContext()` — so `recordGenAiUsage`, `recordLLMCost` and `recordStreamTiming` need no changes and you never report a number twice. Attributes carry the operation, provider, request model, response model and `error.type`. Instruments are rebuilt when the `MeterProvider` changes, so metrics survive a `shutdown()` / `init()` cycle.

This is on by default and a no-op without a registered `MeterProvider`, so a traces-only setup pays nothing. Set `metrics: false` when something upstream already emits `gen_ai.client.*` and you would double-count:

```typescript
traceGenAI({ provider: 'openai', model: 'gpt-4o', metrics: false });
```

`traceGenAI` also sets `error.type` on a failed operation, using the error's name. The spec requires it, and `gen_ai.client.operation.duration` splits on it, so an error-rate query over that metric was impossible before.

New exports: `recordGenAiMetrics` for instrumenting a GenAI call some other way, and `GEN_AI_METRIC.COST_USD` for the cost metric name.

## `autotel-mcp`: speak the current MCP revision (`2026-07-28`)

The server was built on `@modelcontextprotocol/sdk` v1, which tops out at protocol `2025-11-25`. It now uses the `@modelcontextprotocol/server` / `@modelcontextprotocol/node` v2 packages and serves `2026-07-28`: no `initialize` handshake, no `Mcp-Session-Id`, `server/discover` for capability discovery, `resultType` on every result, and `subscriptions/listen` in place of the GET stream.

2025-era clients keep working. Claude Code, Claude Desktop, Cursor and the rest ship the v1 SDK, which opens with the `initialize` handshake; the SDK's stateless legacy path answers them from the same tool definitions, so no MCP client config needs to change. `test/legacy-client.test.ts` drives the real v1 client against the real entry point, over the handshake, `tools/list`, `tools/call` and `resources/list`.

**Breaking:**

- `--transport sse` is gone. HTTP+SSE has been deprecated since protocol `2025-03-26` and is scheduled for removal; `--transport http` is Streamable HTTP, which serves both eras from one endpoint.
- `createApp()` returns `createServer` (a factory) instead of `server` (an instance). There is no handshake and no session to pin an instance to, so the HTTP entry builds one per request and stdio builds one per connection. Anything expensive — the backend, the signal-availability probe — is still built once, at `start()`.

**Security:** the HTTP endpoint now validates the `Origin` and `Host` headers against localhost, which the spec has required of local servers since `2025-06-18`. Binding to `127.0.0.1` was never the mitigation: a page on any origin can post to it.

**Tool metadata:** all 41 tools carry `readOnlyHint` / `idempotentHint` annotations — they read telemetry and nothing else — so a client that honours annotations can run an investigation without stopping to ask about each query. `tools/list` and `resources/list` carry a `ttlMs` / `cacheScope` hint (SEP-2549): the catalog is fixed once the backend is probed and identical for every caller, which matters more now that there is no session to amortise the fetch over.

## `autotel-mcp`: parse the command-line flags the README has always documented

`npx autotel-mcp --transport http --port 3000` and `npx autotel-mcp --persist ./autotel.db` appear in the README, in the MCP client config examples, and in the feature list. Nothing read them. Configuration came from the environment only, so those invocations started a stdio server on the default ports and said nothing about it.

Every environment variable now has a matching flag, and flags win over the environment:

```bash
npx autotel-mcp --transport http --port 3000
npx autotel-mcp --persist ./autotel.db
npx autotel-mcp --backend jaeger --jaeger-url http://localhost:16686
```

`--help` and `--version` work. A flag missing its value exits 2 with a message instead of starting up misconfigured. An unknown flag is reported on stderr and ignored: argv was read by nobody until now, so client configs already in the wild carry flags this binary never defined, and refusing to start would break them.

Credentials stay environment-only, because argv is readable by any process that can list the process table. Passing `--datadog-api-key` is now an error that names `DD_API_KEY` rather than a silent leak. `--datadog-site` is an ordinary flag: a region hostname is not a secret, and `autotel-cli` already exposes it as one.

`createApp()` takes an options object: `createApp({ argv, env })`, or `createApp({ config })` when you have already resolved one. It reads no argv by default, so an embedder's own command line cannot turn into "unknown option" errors. `loadConfig(argv?, env?)` takes both as parameters for the same reason, and `resolveConfig(parsed, env?)` resolves from an already-parsed command line so a caller that needs `--help`, `--version` or the error list does not parse argv twice and reach two different verdicts about it.
