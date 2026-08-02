# autotel-docs

## 0.0.5

### Patch Changes

- 0f518c6: Put every _Observability Engineering_ chapter example under CI, and make the two
  LLM chapters call a real model.

  `pnpm test` ran `run-all.mjs`, which iterated a hardcoded list of the twenty
  numbered chapters. The ten `oe-*` examples ran only under `test:oe`, which
  nothing invoked — `ci.yml` runs `pnpm test`. Every chapter example touching
  `autotel/analysis`, `autotel/slo` and `autotel/sampling` was outside CI, so a
  regression in any of them would have gone green. One runner now globs the
  directory, so a new example is covered the moment it lands.

  Chapters 21 and 22 hand-wrote their evidence: a literal `inputTokens: 120` and a
  hardcoded 620 ms time-to-first-token. A chapter about measuring model behaviour
  that invents its own numbers measures nothing. Both now run against Ollama on
  localhost through `registerTelemetry(autotelTelemetry())`, reading token usage
  and `gen_ai.response.time_to_first_chunk` off the emitted spans. With no model
  reachable they print what they need and exit 0 rather than falling back to
  invented figures, so CI stays green and no run prints a number that came from
  the repo instead of a span.

  Adds `oe-05-structured-events.ts` for chapter 5, which had no example, and
  rewrites `oe-15-sampling.ts` to walk the chapter's full nine-rung sampling
  ladder instead of two rungs. Adds a README carrying the chapter mapping, which
  previously lived only in an untracked file.

  Also upgrades the docs app to Astro 7 and Starlight 0.41, and drops the explicit
  `markdown.gfm` config that Astro 7 no longer needs.

  Removes the `overrides` block from `pnpm-workspace.yaml`. It capped `vite` below
  8 and `@vitejs/plugin-react` at 5.x to protect an Astro 6 docs build, but pnpm
  was ignoring it: root `package.json` already declares `pnpm.overrides`, and pnpm
  reads one source, so the workspace-yaml block never applied. `vite@8.1.5` and
  `@vitejs/plugin-react@6.0.4` install today in spite of it. Deleting the block
  regenerates a byte-identical lockfile, and the failure it described — per-route
  CSS emitted but never linked into `<head>` — does not reproduce on Astro 7,
  which depends on `vite ^8.0.13` regardless.

- 0f518c6: Give each local backend its own compose file under `docker/`, and document
  running them.

  `docker-compose.yml` becomes `docker/jaeger.yml` and `docker-compose.lgtm.yml`
  becomes `docker/lgtm.yml`, so adding a third stack means adding a file rather
  than editing a shared one. Each pins an explicit `name:`, so the compose project
  is identified by the stack rather than by the directory it is run from.

  The LGTM file now publishes Tempo on 3200 and Prometheus on 9090 alongside Loki
  on 3100. Without them the stack accepted telemetry that no tool could read back:
  `autotel-mcp`'s `tempo`, `prometheus` and `loki` backends already default to
  exactly those ports, and its `auto` probes (`/api/echo`, `/api/v1/status/buildinfo`,
  `/ready`) resolve against them unchanged.

  Adds a Local Stacks page covering both stacks, what each is for, and the two
  port clashes worth knowing: the stacks cannot run together because both bind
  OTLP on 4317/4318, and `autotel-devtools` defaults to 4318 so it needs
  `AUTOTEL_DEVTOOLS_PORT=4319` to sit alongside LGTM. The devtools and MCP pages
  link across to it.

## 0.0.4

### Patch Changes

- 5999cb9: Add audit logging capabilities and enhance documentation:
  - **New `autotel-audit` package**: Structured audit logging with compliance-ready features
    - `withAudit()` for wrapping operations with audit metadata and automatic outcome tagging
    - `forceKeepAuditEvent()` to bypass tail-drop sampling for critical audit trails
    - `setAuditAttributes()` for normalized `audit.*` span attributes
    - Type-safe metadata schemas and backend integration support
  - **Documentation enhancements**:
    - Comprehensive integration guide for audit logging
    - Framework-specific setup examples (Express, Fastify, NestJS, Next.js, TanStack)
    - API reference with compliance and sampling strategies
    - Updated documentation site navigation
  - **Runtime helpers and edge improvements**: Enhanced execution logging and request handling across edge runtimes and frameworks

## 0.0.3

### Patch Changes

- dc4908d: Updated deps

## 0.0.2

### Patch Changes

- 2a36104: Add E2E test mode to `auto.ts`: when `E2E=1`, initializes with `InMemorySpanExporter` instead of OTLP and sets `globalThis.__testSpanExporter` for HTTP inspection. Add `createTestSpansHandlers()` and `SerializedSpan` to `autotel-tanstack/testing` for building a zero-boilerplate test-spans HTTP endpoint in Playwright E2E setups.
