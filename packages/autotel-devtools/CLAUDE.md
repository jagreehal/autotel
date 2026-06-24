# autotel-devtools

Standalone OTLP receiver with a Svelte 5-based web UI for local development observability.

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
- `src/cli.ts` — CLI binary (`npx autotel-devtools`); includes the `claude` subcommand that starts the receiver and launches Claude Code wired to it
- `src/server/` — WebSocket server, HTTP routes, OTLP parsing, exporters (`exporter.ts`, `log-exporter.ts`, `remote-exporter.ts`), error aggregation, telemetry limits, resource utils
- `src/widget/` — Svelte 5 UI components, runes-backed signal store, WebSocket client, custom element

## Coding-agent observability (Agents tab)

- Claude Code / opencode emit OTel **metrics + log events** (no traces). `src/server/otlp.ts` `parseOtlpMetrics` (data points, Sum/Gauge/Histogram) and `parseOtlpAgentEvents` decode them; `src/server/otlp-proto.ts` METRICS_PROTO now decodes data points too (protobuf parity).
- The server folds them into an `AgentSessionStore` via the **`autotel-agents`** package (workspace dep) and broadcasts `agents` over WS (full-state, like `errors`). The widget renders them in `AgentsView.svelte` (`src/widget/components/`); store signals live in `store.svelte.ts` (`agentSessionsSignal`, `selectedAgentSession…`, `agentAggregateSignal`).
- `autotel-agents` is browser-safe (no `node:*`); all session reduction logic lives there, not in the widget. Add a new agent (e.g. Codex) by adding one adapter in that package — no devtools change.
- Test data: `src/widget/components/__fixtures__/agents.ts` builds realistic sessions through the real reducers (used by `AgentsView.stories.ts` + `__tests__/AgentsView.test.ts`).

## Boundaries

- **Widget uses Svelte 5** (runes). Reactive state goes through a signal shim over runes (`src/widget/signals.svelte.ts`) that preserves a `.value` API, consumed by `store.svelte.ts`. Components are Tailwind-utility-only — **no `<style>` blocks** (they wouldn't reach the shadow root)
- **Widget CSS**: Tailwind CSS inlined into IIFE bundle via PostCSS
- **Shadow DOM**: Widget CSS is isolated, does not leak into host page
- **Server build**: tsup (ESM + CJS). **Widget build**: Vite IIFE (separate config)
- Do not add Node.js APIs to widget code (it runs in the browser)
- Works with both autotel and standard OpenTelemetry — any OTLP-compatible exporter can send data to it
- OTLP receivers accept **both JSON and protobuf** bodies, dispatched on `Content-Type` (`application/x-protobuf` → decoded in `src/server/otlp-proto.ts` via embedded proto definitions; otherwise OTLP/JSON). This is what lets protobuf-default SDKs (Python/Java/Go) send directly.
