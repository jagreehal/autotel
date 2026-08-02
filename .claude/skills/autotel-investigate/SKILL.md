---
name: autotel-investigate
description: >
  Query OpenTelemetry telemetry (traces, metrics, logs, LLM analytics) via the autotel CLI. Use when the user asks about a production issue, slow request, error spike, expensive LLM call, or any "what is happening in my service" question. Each command returns one JSON document on stdout — parse it and answer from the data.
---

# autotel-investigate

When the user asks about a production issue or telemetry data, drive the `autotel` CLI. Every command emits one JSON document on stdout. Parse `result.data` on success or `result.error` on failure.

## Core principles

1. **Discover, don't recall.** The CLI publishes its own surface — `autotel commands`, `autotel schema`, `autotel <group> --help`. Use those for exact command names, flags and defaults rather than working from memory or from a list in a skill file; they can't go stale against the installed version, and a list here can.
2. **Read what's there before querying it.** `autotel health` tells you whether the backend is even reachable and which signals it serves; `autotel discover trace-fields` tells you which attributes exist before you filter on one.
3. **Answer from the data.** Never present a conclusion the JSON doesn't support. If a query returns nothing, say so — an empty result is a finding, not a failure to be papered over.

## Discovering the command surface

```bash
autotel commands                 # compact listing: every command + whether it mutates, needs network, supports JSON
autotel schema                   # full CLI manifest as JSON (large — prefer `commands` unless you need flag detail)
autotel <group> --help           # flags and defaults for one group, e.g. `autotel query --help`
autotel <group> <cmd> --help     # flags for one command, e.g. `autotel diagnose slos --help`
autotel examples <command>       # copy-pasteable examples
```

`autotel commands` is the cheap default. Reach for `autotel schema` only when you need the full flag surface in one shot.

## Backend selection: required for every query command

Every command that reads telemetry needs a backend. Pick one and reuse it:

| Backend                             | Flags                                                              |
| ----------------------------------- | ------------------------------------------------------------------ |
| Built-in OTLP collector (in-memory) | `--backend collector`                                              |
| Jaeger                              | `--backend jaeger --jaeger-base-url http://localhost:16686`        |
| Tempo                               | `--backend tempo --tempo-base-url http://localhost:3200`           |
| Prometheus                          | `--backend prometheus --prometheus-base-url http://localhost:9090` |
| Loki                                | `--backend loki --loki-base-url http://localhost:3100`             |
| Tempo + Prom + Loki together        | `--backend stack` + the three URL flags                            |
| Auto-detect localhost               | `--backend auto`                                                   |
| Local JSON fixture                  | `--backend fixture --fixture-path ./telemetry.json`                |

Hosted vendors (traces only — `capabilities` will report metrics and logs unsupported):

| Backend          | Flags                                                                    | Credentials (environment only)                                                      |
| ---------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Pydantic Logfire | `--backend logfire [--logfire-base-url https://logfire-eu.pydantic.dev]` | `LOGFIRE_READ_TOKEN` (must be **read**-scope; a write token is rejected)            |
| Datadog APM      | `--backend datadog [--datadog-site datadoghq.eu]`                        | `DD_API_KEY` **and** `DD_APP_KEY` (an application key is separate from the API key) |
| SigNoz           | `--backend signoz --signoz-base-url https://signoz.example.com`          | `SIGNOZ_API_KEY` (omit for an unauthenticated self-hosted instance)                 |

Credentials are read from the environment and never accepted as flags — argv is visible to anything that can list the process table. Never ask the user to paste a key into the chat; ask them to export it.

Environment variables work for backend selection too (`AUTOTEL_BACKEND`, `JAEGER_BASE_URL`, …). Flags win over env. If you're not sure which backend is configured, run `autotel health` first — a misconfigured vendor backend reports `healthy: false` with the missing variable named, rather than failing the command.

Some commands need no backend at all — semantic-convention lookup, span scoring and collector-config work are all local. `autotel commands` marks which need network.

## Decision tree: pick a command

1. **"Is anything broken?"** → `autotel diagnose errors` (recent error spans grouped by service/operation)
2. **"What's slow?"** → `autotel diagnose anomalies`, or `autotel llm slow` for LLM-heavy services
3. **"Show me trace `<id>`"** → `autotel trace get <id>` for raw, `autotel trace summary <id>` for incident-friendly
4. **"Why did this trace fail?"** → `autotel diagnose root-cause <id>`, then `autotel correlate trace <id>` for the full picture
5. **"Why is service X degraded?"** → `autotel correlate explain-slowdown --service X` (anomalies + root causes + logs)
6. **"How much are we spending on LLMs?"** → `autotel llm usage`, then `autotel llm expensive` for top traces
7. **"What services / ops / fields exist?"** → `autotel discover services` / `autotel topology services` / `autotel discover trace-fields`
8. **"Are we meeting SLOs?"** → `autotel diagnose slos --service X` (thresholds are flags — check `--help`)
9. **"Are we under attack / any security signals?"** → `autotel security summary` (auth events, probes, denied responses)
10. **"Any MCP prompt-injection / tool abuse?"** → `autotel security mcp` (injection verdicts, output-budget breaches, untrusted-content tool calls)
11. **"Is my telemetry even arriving?"** → `autotel health --otlp-endpoint <url>` writes a probe span and reports ingest-to-queryable lag

## Command groups

Use these to know _where_ to look; use `--help` on the group for the exact commands and flags.

| Group                    | What it answers                                                                  | Needs a backend |
| ------------------------ | -------------------------------------------------------------------------------- | --------------- |
| `health`, `capabilities` | Is the backend reachable, which signals does it serve, how stale is the data     | yes             |
| `discover`               | Which services exist, which span/log fields exist and their example values       | yes             |
| `query`                  | Raw search over traces, spans, metrics, logs                                     | yes             |
| `trace`                  | Fetch or summarise one trace by id                                               | yes             |
| `topology`               | Services, operations, dependency map                                             | yes             |
| `diagnose`               | Anomalies, root cause, error grouping, SLO checks                                | yes             |
| `correlate`              | One trace across traces + metrics + logs; slowdown explanations                  | yes             |
| `llm`                    | Token/cost usage, model stats, expensive and slow traces, tool spans             | yes             |
| `security`               | `security.*` events, suspicious requests, denied responses, MCP boundary signals | yes             |
| `semconv`                | OpenTelemetry semantic-convention lookup                                         | no              |
| `score`                  | Score a span for instrumentation quality (JSON on stdin)                         | no              |
| `collector`              | Validate, explain and generate OTLP Collector config                             | no              |

## Measuring ingest lag

`autotel health --otlp-endpoint http://localhost:4318` writes one probe span and polls until it reads back, reporting `freshness.timeToQueryableSeconds`.

This matters before you trust a negative result: backends differ by two orders of magnitude in ingest lag, and on a slow one an agent that writes then immediately reads sees nothing and wrongly concludes the operation produced no telemetry. If a trace you expect is missing, check freshness before concluding it was never emitted. `--freshness-timeout-ms` bounds the wait (default 120000).

Against a hosted endpoint the probe write needs auth, taken from the standard `OTEL_EXPORTER_OTLP_HEADERS` (`Authorization=<token>`) so no token lands in argv. Note this is the **write** credential, which for most vendors is a different token from the read one the query backend uses.

The probe sends OTLP protobuf by default — the encoding every OTLP/HTTP receiver must accept, and the only one some vendors take. The built-in collector parses JSON only and is switched automatically; anything else can be forced with `--otlp-encoding json`. If a receiver rejects the payload, the error says which encoding was sent and which to try.

## Output contract

```json
// success
{ "ok": true, "command": "query traces", "data": { … } }

// failure
{ "ok": false, "error": { "type": "validation"|"runtime", "code": "AUTOTEL_E_*", "message": "…", "retryable": false } }
```

Exit codes: `0` success, `2` validation error, `1` runtime error.

Always parse the JSON; never try to read prose from stdout.

## When to use this vs the MCP server

- Use this skill when: the user just wants an answer, you're driving a one-shot prompt, or no MCP server is configured.
- Prefer `autotel-mcp` when: the session is an extended incident review with many follow-ups against a slow remote backend (the persistent connection wins on repeated queries).

Both return the same data. Pick the one with less ceremony for the situation.
