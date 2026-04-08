# autotel-devtools

Standalone OTLP receiver with a Preact-based web UI for local development observability.

## Architecture

Two build outputs:
- **Server** (tsup): Node.js library + CLI — receives OTLP data via HTTP, streams to browser via WebSocket
- **Widget** (Vite IIFE): Browser bundle — `<autotel-devtools>` custom element with Shadow DOM isolation

## Quick Commands

```bash
pnpm build              # Build server (tsup) + widget (Vite IIFE)
pnpm test               # Run all tests
pnpm lint               # Lint source
pnpm type-check         # TypeScript check
pnpm storybook          # Launch Storybook for widget components
```

## Package Exports

- `.` — `createDevtools()` factory, `DevtoolsServer`, `DevtoolsSpanExporter`, `DevtoolsLogExporter`, `DevtoolsRemoteExporter`, `ErrorAggregator`, types
- `./server` — `DevtoolsServer`, exporters, OTLP parsing (`parseOtlpTraces`, `parseOtlpLogs`), HTTP routes (`attachDevtoolsRoutes`, `createDevtoolsHttpServer`), telemetry limits (`resolveTelemetryLimits`, `appendWithLimit`)
- `./exporter` — `DevtoolsSpanExporter` (standalone)

## Key Files

- `src/index.ts` — Main entry, `createDevtools()` factory
- `src/cli.ts` — CLI binary (`npx autotel-devtools`)
- `src/server/` — WebSocket server, HTTP routes, OTLP parsing, exporters (`exporter.ts`, `log-exporter.ts`, `remote-exporter.ts`), error aggregation, telemetry limits, resource utils
- `src/widget/` — Preact UI components, signals store, WebSocket client, custom element

## Boundaries

- **Widget uses Preact** (not React) with `jsxImportSource: "preact"`
- **Widget CSS**: Tailwind CSS inlined into IIFE bundle via PostCSS
- **Shadow DOM**: Widget CSS is isolated, does not leak into host page
- **Server build**: tsup (ESM + CJS). **Widget build**: Vite IIFE (separate config)
- Do not add Node.js APIs to widget code (it runs in the browser)
- Works with both autotel and standard OpenTelemetry — any OTLP-compatible exporter can send data to it
