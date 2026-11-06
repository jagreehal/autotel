# PM2 with autotel

Runs autotel and `pm2-io-otel` in one process under PM2. Autotel owns tracing and exports to OTLP and PM2. `pm2-io-otel` keeps metrics and remote actions.

```bash
pnpm verify   # real PM2 daemon in a temp PM2_HOME, local OTLP sink, asserts every path
pnpm start    # the server alone, OTLP to OTLP_ENDPOINT (default http://localhost:4318)
```

## Turn off pm2-io-otel tracing

```ts
io.init({ tracing: { enabled: false } });
```

`io.init({})` and `tracing: false` both turn tracing on, which starts a second `NodeSDK`. OpenTelemetry keeps the first global tracer provider, and `init()` warns when that provider belongs to someone else:

| `tracing`            | Init order    | Autotel OTLP | PM2 traces                              |
| -------------------- | ------------- | ------------ | --------------------------------------- |
| `{ enabled: false }` | either        | yes          | none, unless you add the exporter below |
| on                   | autotel first | yes          | none                                    |
| on                   | pm2 first     | **none**     | yes                                     |

## Spans in PM2

`src/pm2-span-exporter.ts` sends autotel spans as `trace-span` messages, with status, dropped counts, resource tags and event annotations.

`spanExporters` replaces the default OTLP pipeline, so `server.ts` lists OTLP too.

## Scope

- `verify` checks the messages on the PM2 bus. Check the PM2 Plus dashboard against your own account.
- This example creates spans with `trace()` and `span()`. If you add `HttpInstrumentation`, confirm it emits spans under PM2 first.

## pnpm

`packageExtensions` in the root `pnpm-workspace.yaml` declares the packages `pm2-io-otel` imports at runtime. Copy that block if you use pnpm.
