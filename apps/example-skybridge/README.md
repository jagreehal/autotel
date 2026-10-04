# Skybridge example

A [Skybridge](https://github.com/alpic-ai/skybridge) MCP App traced with `autotel-skybridge`: two tools (one with a React view, one that throws) and a client script that calls them through `instrumentMcpClient`, so client and server spans form one trace.

## Run

```bash
pnpm --filter autotel-skybridge build
cd apps/example-skybridge
pnpm build && pnpm start   # http://localhost:3000/mcp
pnpm call                  # in another terminal
```

`pnpm dev` runs the Skybridge dev server with the view emulator instead of `build` + `start`.

Spans print in both terminals (`debug: 'pretty'`). `AUTOTEL_DEBUG=true` prints raw spans with trace and span IDs. Set `OTEL_EXPORTER_OTLP_ENDPOINT` to send them to a collector.

`src/instrumentation.ts` (and the scripts, for the CLI) set `SKYBRIDGE_TELEMETRY_DISABLED=1`, which turns off Skybridge's own usage telemetry: the CLI's PostHog events and the per-tool-call UDP counter.

## Deploy to Vercel

`pnpm build` writes Vercel's prebuilt output (`.vercel/output`, a Node function), so:

```bash
vercel env add OTEL_EXPORTER_OTLP_ENDPOINT    # e.g. Grafana Cloud's /otlp URL
vercel env add OTEL_EXPORTER_OTLP_HEADERS     # Authorization=Basic%20...
pnpm build && vercel deploy --prebuilt
```

`src/instrumentation.ts` pins autotel's bundled JSON exporter, which hosted OTLP gateways accept, and turns on `forceFlushOnShutdown` under Vercel so each request exports its spans before the function freezes.

## What to look for

- `tools/call search-flights` on the server has the client's span as its parent, and `db.query flights` nests under it.
- `tools/call book-flight` records `ERROR` with `error.type=tool_error`, `mcp.failure.fingerprint`, and an `exception` event holding `Unknown flight XX999`.
