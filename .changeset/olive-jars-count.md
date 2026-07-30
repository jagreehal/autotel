---
'autotel-cli': minor
'autotel': minor
'autotel-adapters': patch
---

Add `autotel map`, plus request lifecycle correctness fixes.

**`autotel map`** scores the observability of every entry point in a project. It
reads the source (no runtime, no network), detects the framework, finds every
entry point, and reports what context you would have when each one breaks:
whether it produces a span, whether that span carries business context, whether
thrown errors explain themselves, whether catch blocks record the failure,
whether money and auth paths leave an audit trail, and whether data-loading
pages handle request failures.

- `autotel map` — score plus the three entry points worth fixing first
- `autotel map --all` — every entry point as a check matrix
- `autotel map <route|file>` — one entry point, every check, and the code that fixes it
- `autotel map --json` — every finding with `evidence` and `fix`, for agents
- `autotel map --min-score <n>` / `--baseline [path|git:<ref>]` — CI gates; the
  baseline compares per check, so a refactor that instruments one route and
  breaks another still fails
- `// autotel-map-disable <check> -- reason` waives a check in code; waived
  checks cost no score and are counted separately from real coverage
- Opportunities highlight repeated inline errors in projects with an error
  catalog, and uncovered writes in projects that already record audit signals

Frameworks: Next.js, Nitro/Nuxt, TanStack Start, SvelteKit, Hono, Express,
Fastify, Elysia, Cloudflare Workers.

**Request lifecycle:**

- add `RequestLogger.setLevel()` for explicit canonical snapshot severity
- add retry classification to `createDrainPipeline()` so permanent failures can
  be dropped without repeated delivery attempts
- keep Next.js navigation signals out of error telemetry, including wrapped
  signals
- defer Hono SSE, NDJSON, and AI-stream snapshots until the response body
  settles
