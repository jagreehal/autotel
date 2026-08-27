# Autotel Agent Skills

Skills for AI assistants (Claude Code, Cursor, Windsurf, Continue, and any tool that follows the [Agent Skills specification](https://agentskills.io/specification)). They live here at the repo root, not inside the npm packages, so the [skills CLI](https://github.com/vercel-labs/skills) finds each one at `skills/<category>/<name>/SKILL.md`. This directory is the single source of truth.

## Install

```bash
npx skills add jagreehal/autotel                     # browse and pick
npx skills add jagreehal/autotel --skill autotel-core
npx skills add jagreehal/autotel --skill autotel-tanstack
```

Skills no longer ship inside the package tarballs, so `npm install autotel` does not add them. Pick the ones you want with the command above.

## Versions

These skills describe the current API. Where a skill names something newer than the version you have installed, it says so at that point. The one that bites most often: `trace.run()` arrived in autotel 7.0, and on 6.x the immediate form is `span(name, fn)`.

## Categories

- **core** — the `autotel` package: choosing an API, instrumentation, request logging, structured errors, events, plus task skills for tracing, sampling, audit trails, and debugging.
- **frameworks** — web frameworks and runtimes: TanStack Start, Cloudflare, Hono, Nuxt, edge, browser, terminal.
- **integrations** — libraries, vendors, and tooling: GenAI, Drizzle, Mongoose, AWS, Sentry, subscribers, MCP, contract testing, and more.
- **extending** — build your own on autotel's public extension points: a custom event subscriber, a custom span exporter, or a middleware for a framework with no packaged adapter.

## core

| Skill                                                                  | What it covers                                                                                                                                                    |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`analyze-traces`](core/analyze-traces/SKILL.md)                       | Analyze OpenTelemetry traces and structured logs from a running autotel service to debug errors, investigate latency, follow requests across services, and surfa… |
| [`autotel-core`](core/autotel-core/SKILL.md)                           | When to use trace vs span vs request logger vs events in Autotel. Init once at startup, package exports (autotel, autotel/event, autotel/testing). Use for setup… |
| [`autotel-events`](core/autotel-events/SKILL.md)                       | track(), Event API, subscribers (e.g. PostHog). Configure subscribers in init(); use track() or Event for product/analytics events.                               |
| [`autotel-frameworks`](core/autotel-frameworks/SKILL.md)               | Hono, Fastify, TanStack Start, Cloudflare Workers, NestJS, SvelteKit, Elysia, Nuxt. Middleware and init; getRequestLogger() in handlers. Load when adding Autote… |
| [`autotel-instrumentation`](core/autotel-instrumentation/SKILL.md)     | trace(), span(), instrument(), init(). Factory vs direct pattern, name inference. Sync init; use node-require for optional deps. Load when wrapping handlers or … |
| [`autotel-request-logging`](core/autotel-request-logging/SKILL.md)     | getRequestLogger(), set(), info/warn/error, emitNow(). One snapshot per request; requires active span. Use when adding request-scoped context or replacing scatt… |
| [`autotel-structured-errors`](core/autotel-structured-errors/SKILL.md) | createStructuredError, parseError, recordStructuredError. API errors with message, why, fix, link; client parsing for UI. Use in API routes and client catch blo… |
| [`build-audit-trails`](core/build-audit-trails/SKILL.md)               | Build or review tamper-aware audit trails on top of OpenTelemetry spans using autotel and the autotel-audit package (`withAudit`, `setAuditAttributes`, `forceKe… |
| [`debug-missing-spans`](core/debug-missing-spans/SKILL.md)             | Troubleshoot when expected OpenTelemetry spans don't reach the backend. Walks the chain top-to-bottom — code → SDK init → processor → exporter → network → backe… |
| [`design-alertable-metrics`](core/design-alertable-metrics/SKILL.md)   | Design metrics an alarm can be written against — the label that isolates one failing dependency, metric names as a contract, cardinality, SLO burn-rate alerts,…  |
| [`find-observability-gaps`](core/find-observability-gaps/SKILL.md)     | Score the observability of every entry point with `autotel map`, then close the gaps it reports: which handlers are dark, which money/auth paths lack an audit…   |
| [`migrate-to-autotel`](core/migrate-to-autotel/SKILL.md)               | Migrate an existing observability setup to autotel. Handles raw @opentelemetry/sdk-node, Sentry tracer (`@sentry/node`), Datadog APM (`dd-trace`), New Relic age… |
| [`review-otel-patterns`](core/review-otel-patterns/SKILL.md)           | Review TypeScript/JavaScript code for OpenTelemetry instrumentation patterns and guide adoption of autotel. Covers Next.js, Nuxt, Nitro, TanStack Start, SvelteK… |
| [`tune-sampling`](core/tune-sampling/SKILL.md)                         | Choose a sampling strategy for an autotel-instrumented service. Covers head sampling (per-span-kind rates, parent-based, ratio), tail sampling (keep errors, slo… |

## frameworks

| Skill                                                          | What it covers                                                                                                                                                    |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`autotel-cloudflare`](frameworks/autotel-cloudflare/SKILL.md) | Instrumenting a Cloudflare Worker with OpenTelemetry — tracing fetch handlers, wrapping bindings (KV, R2, D1, AI, Vectorize, Queues, Durable Objects), or wiring… |
| [`autotel-edge`](frameworks/autotel-edge/SKILL.md)             | Adding OpenTelemetry to an edge runtime with no Node.js APIs (Cloudflare Workers, Vercel Edge, Deno) — trace(), span(), instrument(), sampling, events, and the … |
| [`autotel-hono`](frameworks/autotel-hono/SKILL.md)             | Tracing a Hono app with OpenTelemetry — adding the otel() middleware to emit HTTP spans with semantic attributes, capture headers, and record request metrics.    |
| [`autotel-nuxt`](frameworks/autotel-nuxt/SKILL.md)             | Adding OpenTelemetry to a Nuxt app — the Nuxt module that wires Autotel's Nitro adapters into server routes and API handlers.                                     |
| [`autotel-tanstack`](frameworks/autotel-tanstack/SKILL.md)     | Instrumenting TanStack Start with OpenTelemetry — tracing server functions, route loaders, middleware, and request handlers via the zero-config, middleware, or … |
| [`autotel-terminal`](frameworks/autotel-terminal/SKILL.md)     | Integrating the autotel-terminal dashboard into a Node.js app or running it as a standalone OTLP receiver — covers renderTerminal(), StreamingSpanProcessor, the… |
| [`autotel-web`](frameworks/autotel-web/SKILL.md)               | Adding distributed tracing to a browser application — covers lean mode (traceparent header injection, ~1.6KB), full mode (real OTel spans, Web Vitals, error cap… |

## integrations

| Skill                                                                              | What it covers                                                                                                                                                    |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`autotel-adapters`](integrations/autotel-adapters/SKILL.md)                       | Adding request-scoped logging and tracing to Next.js, Nitro, Cloudflare Workers, Hono, or TanStack Start through autotel's uniform adapter shape — withAutotel m… |
| [`autotel-agents`](integrations/autotel-agents/SKILL.md)                           | Turning the OpenTelemetry metrics and log events from a coding agent (Claude Code, opencode, Codex) into a session model — ingesting decoded OTLP records, summa… |
| [`autotel-audit`](integrations/autotel-audit/SKILL.md)                             | Writing compliance audit trails or security events that must survive tail-sampling — withAudit() for actor/resource/action logging, forceKeepAuditEvent() to byp… |
| [`autotel-aws`](integrations/autotel-aws/SKILL.md)                                 | Instrumenting AWS with OpenTelemetry — Lambda handlers, SDK v3 clients, S3, DynamoDB, SQS, SNS, Kinesis, Step Functions, and X-Ray, built on autotel.             |
| [`autotel-backends`](integrations/autotel-backends/SKILL.md)                       | Configuring autotel for a specific vendor backend — ready-made AutotelConfig presets for Honeycomb, Datadog, Google Cloud, and Grafana Cloud with best-practice … |
| [`autotel-cli`](integrations/autotel-cli/SKILL.md)                                 | Running autotel CLI commands to set up, configure, or extend OpenTelemetry instrumentation in a Node.js project — including init, doctor, add, and codemod trace… |
| [`autotel-devtools`](integrations/autotel-devtools/SKILL.md)                       | Standalone OTLP receiver with a Svelte web UI for local-dev observability. Use when a developer wants to see OpenTelemetry traces, logs, metrics, and service ma… |
| [`autotel-drizzle`](integrations/autotel-drizzle/SKILL.md)                         | Adding OpenTelemetry tracing to a Drizzle ORM database instance — the only autotel instrumentation package needed for Drizzle, since no official OTel package ex… |
| [`autotel-eventcatalog`](integrations/autotel-eventcatalog/SKILL.md)               | Keeping an EventCatalog honest against runtime behaviour — the autotel-eventcatalog drift command to diff the catalog against an autotel snapshot in CI, generat… |
| [`autotel-genai`](integrations/autotel-genai/SKILL.md)                             | Instrumenting AI/LLM/agent code with OpenTelemetry GenAI semantic conventions — traceGenAI() spans, token usage and cost, gen_ai.* attributes, GenAI metric view… |
| [`autotel-grafana`](integrations/autotel-grafana/SKILL.md)                         | Dashboards and alert rules as files in the repo that owns the service — the `grafana/` folder, alert rule YAML, contact points and routing, proving an alarm fir… |
| [`autotel-langfuse`](integrations/autotel-langfuse/SKILL.md)                       | Sending autotel traces to Langfuse — langfuseCompatibility() for the fields Langfuse keeps in its own columns, langfuseScores() for evaluations, langfuseMe…      |
| [`autotel-mcp`](integrations/autotel-mcp/SKILL.md)                                 | MCP server AI agents connect to for investigating OpenTelemetry telemetry. Use when an agent needs to query traces, metrics, or logs from Jaeger, Tempo, Prometh… |
| [`autotel-mcp-instrumentation`](integrations/autotel-mcp-instrumentation/SKILL.md) | Instrumenting an MCP (Model Context Protocol) server or client with OpenTelemetry — instrumentMcpServer/instrumentMcpClient, W3C trace context via _meta across … |
| [`autotel-message-contract`](integrations/autotel-message-contract/SKILL.md)       | Pinning the serialized shape of events, commands, or queue payloads as ordinary unit tests — messageContract() snapshot checks with a committed approved file, v… |
| [`autotel-mongoose`](integrations/autotel-mongoose/SKILL.md)                       | Adding OpenTelemetry tracing to a Mongoose 8+ application — covers instrumentMongoose(), query text capture, automatic PII redaction, and Schema hook instrument… |
| [`autotel-pact`](integrations/autotel-pact/SKILL.md)                               | You run Pact contracts and want evidence each interaction actually fired — withPactInteraction/auto-wrap to record consumer test runs, withProviderVerification … |
| [`autotel-playwright`](integrations/autotel-playwright/SKILL.md)                   | Linking Playwright e2e tests to server-side traces — the fixture and reporter that create one OTel span per test and inject W3C trace context into API requests.  |
| [`autotel-plugins`](integrations/autotel-plugins/SKILL.md)                         | Instrumenting BigQuery, Kafka, or RabbitMQ with OpenTelemetry — plugins for libraries with no official OTel support (BigQuery) or where the official package lac… |
| [`autotel-posthog`](integrations/autotel-posthog/SKILL.md)                         | Joining autotel traces to PostHog sessions, replays and events — joinPostHog() for both directions, replay links on failed spans, and the async-context tra…      |
| [`autotel-schema`](integrations/autotel-schema/SKILL.md)                           | Treating a service's telemetry surface as a typed, versioned contract — defineContract() to declare span names and attributes, createSchemaValidationProcessor()… |
| [`autotel-sentry`](integrations/autotel-sentry/SKILL.md)                           | Sending autotel/OpenTelemetry traces to Sentry — the bridge that converts OTel spans to Sentry transactions and propagates sentry-trace/baggage headers, linking… |
| [`autotel-subscribers`](integrations/autotel-subscribers/SKILL.md)                 | Event subscribers for autotel. PostHog, Mixpanel, Amplitude, Segment, Webhook, Slack. Configure in init() subscribers; use track() or Event from autotel. Import… |
| [`autotel-telemetry`](integrations/autotel-telemetry/SKILL.md)                     | Adding opt-in CLI usage telemetry to an Autotel-powered command-line tool — withCommanderTelemetry() to instrument a Commander program, and the DO_NOT_TRACK / A… |
| [`autotel-vitest`](integrations/autotel-vitest/SKILL.md)                           | Adding OpenTelemetry tracing to Vitest tests — gives each test a parent span so all instrumented code becomes filterable child spans in your OTLP backend.        |
| [`autotel-vscode`](integrations/autotel-vscode/SKILL.md)                           | Working with the Autotel VS Code extension — a local OTLP/HTTP receiver on 127.0.0.1:4318 that buffers traces and logs, shows Services/Traces/Logs/Errors views,… |
| [`autotel-webmcp`](integrations/autotel-webmcp/SKILL.md)                           | Tracing WebMCP tools in the browser — tools a page registers through `document.modelContext` for a browser agent to call. Registration and execution spans, opt-… |

## extending

| Skill                                                                       | What it covers                                                                                                                                                    |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`autotel-custom-exporter`](extending/autotel-custom-exporter/SKILL.md)     | Shipping autotel spans to a backend that has no preset and no plain OTLP endpoint — implement the OpenTelemetry SpanExporter interface and pass it through init(… |
| [`autotel-custom-framework`](extending/autotel-custom-framework/SKILL.md)   | Instrumenting a web framework or runtime that autotel has no packaged adapter for — build your own request middleware from the primitives: trace()/span() for th… |
| [`autotel-custom-subscriber`](extending/autotel-custom-subscriber/SKILL.md) | Routing autotel product events (track(), Event) to a destination that has no built-in subscriber — a data warehouse, an internal queue, a custom HTTP sink. Impl… |

## Skill format

Each skill follows the [Agent Skills specification](https://agentskills.io/specification). Minimal frontmatter:

```yaml
---
name: kebab-case-name
description: >
  What the skill does and the branches that should trigger it.
---
```

References (`scripts/`, `references/`, `assets/`) load lazily; agents fetch them only when a step needs them.
