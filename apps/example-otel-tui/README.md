# example-otel-tui

Demonstrates traces, spans, and Pino logs fully correlated in [otel-tui](https://github.com/ymtdzzz/otel-tui).

## Prerequisites

- Docker & Docker Compose
- pnpm

## Quick start

You need two terminals.

### Terminal 1 — start otel-tui

```bash
cd apps/example-otel-tui

# Start otel-tui in the background (listens on OTLP ports 4317/4318)
docker compose up -d
```

### Terminal 2 — send telemetry

```bash
cd apps/example-otel-tui

# Install deps (from monorepo root works too: pnpm install)
pnpm install

# One-shot: generates 3 order traces + 1 health check, then exits
pnpm start

# Or continuous mode: streams traces every 1-3s until you Ctrl+C
pnpm start:loop
```

### Terminal 1 — view in otel-tui

```bash
# Attach your terminal to the otel-tui TUI
docker compose attach oteltui
```

You're now inside otel-tui. Navigate with:

| Key | Action |
|-----|--------|
| `Tab` | Switch between Traces / Logs tabs |
| `↑` / `↓` | Select a trace or span |
| `Enter` | Expand/inspect a trace's span tree |
| `Ctrl+p` then `Ctrl+q` | Detach from otel-tui (keeps it running) |

### Cleanup

```bash
docker compose down
```

## What you'll see

**Traces tab** — traces named `order.process`, `api.request`, `health.check`

**Span tree** — select a trace to see nested spans:

```
order.process (root)
├── db.users.find
├── inventory.check
├── order.validate
├── payment.charge
└── email.send
```

**Logs tab** — Pino logs correlated by `trace_id` and `span_id`. Select a trace to see only its logs. Each log is attached to the exact span that produced it.

## How it works

The key to trace↔log correlation:

1. **Pino instrumentation** (`@opentelemetry/instrumentation-pino`) automatically injects `trace_id` and `span_id` into every Pino log record emitted inside a traced context
2. **OTLP log exporter** (`BatchLogRecordProcessor` + `OTLPLogExporter`) sends those enriched log records to otel-tui via HTTP on port 4318
3. **OTLP trace exporter** sends traces/spans to the same endpoint
4. **otel-tui** indexes logs by `trace_id`/`span_id` and shows them alongside the span tree

The wiring happens in `src/instrumentation.mjs` — loaded before the app via `tsx --import`.
