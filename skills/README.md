# autotel Agent Skills

35 skills for AI assistants working with autotel and OpenTelemetry. Skills are auto-discovered by compatible agents (Claude Code, Cursor, Windsurf, Continue, …).

## Install

```bash
npx skills add https://github.com/jagreehal/autotel
```

…or, if you've cloned the repo, point your agent at `./skills/index.json`.

## What's here

### Top-level skills (this directory)

| Skill | Purpose |
| --- | --- |
| [`create-autotel-adapter`](create-autotel-adapter/SKILL.md) | Author a new framework adapter (Elysia, Fastify, …). |
| [`create-autotel-instrumentation`](create-autotel-instrumentation/SKILL.md) | Auto-instrument a third-party library (Drizzle, Mongoose, Redis, …). |
| [`create-autotel-exporter`](create-autotel-exporter/SKILL.md) | Ship a new vendor exporter with retry, batch, error handling. |
| [`build-audit-trails`](build-audit-trails/SKILL.md) | Tamper-aware audit logs on top of OTel spans. |
| [`migrate-to-autotel`](migrate-to-autotel/SKILL.md) | Migrate from raw OTel SDK / Sentry / Datadog APM / New Relic / OpenTracing. |
| [`tune-sampling`](tune-sampling/SKILL.md) | Head + tail sampling strategies, error-keep, AI-aware. |
| [`debug-missing-spans`](debug-missing-spans/SKILL.md) | Troubleshoot when traces don't reach the backend. |

### Flagship skills (`packages/autotel/skills/`)

| Skill | Purpose |
| --- | --- |
| `review-otel-patterns` | Audit a codebase for OTel anti-patterns; covers 13+ frameworks. |
| `analyze-traces` | Read OTLP traces from any backend, local dump, or in-memory exporter. |
| `autotel-core` / `autotel-events` / `autotel-frameworks` / `autotel-instrumentation` / `autotel-request-logging` / `autotel-structured-errors` | Domain-specific deep dives. |

### Per-package skills

Each package under `packages/autotel-*` ships its own skill: `autotel-adapters`, `autotel-aws`, `autotel-backends`, `autotel-cli`, `autotel-cloudflare`, `autotel-devtools`, `autotel-drizzle`, `autotel-edge`, `autotel-hono`, `autotel-mcp`, `autotel-mcp-instrumentation`, `autotel-mongoose`, `autotel-playwright`, `autotel-plugins`, `autotel-sentry`, `autotel-subscribers`, `autotel-tanstack`, `autotel-terminal`, `autotel-vitest`, `autotel-web`.

## How an agent picks the right skill

| Scenario | Skill |
| --- | --- |
| "Help me set up tracing on this Next.js app" | `review-otel-patterns` |
| "Why are my checkout traces missing?" | `debug-missing-spans` |
| "We're getting hit on cost — tune sampling" | `tune-sampling` |
| "Add tracing for our new ORM" | `create-autotel-instrumentation` |
| "Build a Fastify integration" | `create-autotel-adapter` |
| "Switch us from Datadog APM to Honeycomb" | `migrate-to-autotel` |
| "Design our audit trail" | `build-audit-trails` |
| "Read this trace and tell me what's slow" | `analyze-traces` |

## Validating skills locally

```bash
pnpm intent:validate
```

Validates SKILL.md frontmatter for every package skill via `@tanstack/intent`.

## Skill schema

Skills use the [Anthropic Agent Skills](https://github.com/anthropics/agent-skills-spec) format. Frontmatter:

```yaml
---
name: kebab-case-name
description: >
  One-paragraph summary of what the skill does and when to use it.
  Used by agents to pick a relevant skill.
type: review | create | analyze | migrate | tune | debug | core
library: autotel
license: MIT
---
```

References are loaded lazily — agents only fetch them when actively needed.
