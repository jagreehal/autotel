# autotel-agents

## 0.5.0

### Minor Changes

- 10c3f93: Track the current OpenTelemetry releases: SDK 2.11.0, experimental 0.222.0,
  auto-instrumentations 0.80.0.

  Spans now carry the current names for the attributes OpenTelemetry has renamed,
  so they line up with every other OTel producer:

  | before                | now                         |
  | --------------------- | --------------------------- |
  | `http.method`         | `http.request.method`       |
  | `http.status_code`    | `http.response.status_code` |
  | `http.url`            | `url.full`                  |
  | `http.scheme`         | `url.scheme`                |
  | `http.host`           | `server.address`            |
  | `http.target`         | `url.path` (+ `url.query`)  |
  | `db.system`           | `db.system.name`            |
  | `db.operation`        | `db.operation.name`         |
  | `db.name`             | `db.namespace`              |
  | `db.statement`        | `db.query.text`             |
  | `db.sql.table`        | `db.collection.name`        |
  | `rpc.system`          | `rpc.system.name`           |
  | `messaging.operation` | `messaging.operation.type`  |

  This covers `autotel`, `autotel-aws`, `autotel-cloudflare`, `autotel-tanstack`
  and `autotel-web`. Queries, dashboards and alerts pinned to the previous
  spellings should move to the new ones. `deployment.environment` now ships
  alongside `deployment.environment.name` everywhere, matching what `init()`
  already did.

  Everything that reads spans — `autotel-devtools`, `autotel-terminal`,
  `autotel-mcp`, `autotel-agents`, `autotel-audit`, `autotel-vscode`,
  `autotel-cli` — accepts both spellings, so existing traces keep rendering,
  filtering and aggregating as they did.

  `rpc.service` is unchanged. `autotel-drizzle` and `autotel-plugins` keep their
  `'legacy'` semconv mode exactly as documented.

## 0.4.0

### Minor Changes

- 559ec46: Say what a trace could not see, and what a sequence of calls means.

  A trace that lost a fact and a trace that never could capture it look identical
  once they reach a backend — both read as complete, because the timeline has a
  start and an end. These packages now narrow that claim in-band, on the spans
  themselves.

  **Evidence quality** (`autotel/evidence`). `recordEvidence()` labels one field
  (`observed` / `inferred` / `estimated` / `truncated` / `redacted` / `absent` /
  `unobservable`); `captureCoverageAttributes()` declares which capture surfaces a
  process observes at all. No label means unknown — nothing here asserts
  completeness. The lossy paths now announce themselves: truncated captures set
  `autotel.evidence.input|output`, `recordLLMCost()` labels its figure `estimated`
  (or `unobservable` when no pricing matched) so a price-table number is never
  mistaken for a bill, and `sanitizeAuditPayloadWithEvidence()` reports what a
  privacy profile removed, with the counts covered by the audit event hash.

  **Approvals say whether anyone saw them.** `recordHumanApproval()` stamps
  `agent.consent.evidence`, defaulting to `inferred`: no runtime reports the
  human's click, so most approvals are deduced from the tool having run, and that
  deduction must never be citable as a human decision.

  **Sequence detection** (`autotel-genai/agent`). Ordered steps within one
  session: `denied-then-executed` requires the denial to come first, and
  reversed it does not fire. `emitSequenceDetections()` writes each finding as its
  own correlated log record, and `recordDetectionDisposition()` records what a
  human decided — refusing to close a finding as `false_positive` or
  `risk_accepted` without a written reason. Both sides carry the same flat
  `detection.rule_id` / `detection.correlation_id` keys, which is what joins a
  finding to a decision made hours later in a different trace.
  `sequenceRulesToSigma()` generates SIEM rules from the same rule set.

  **Context compaction** (`autotel-agents`, `autotel-devtools`). Agents replace
  the conversation with a summary and carry on; nothing announces it, but the
  token counts show the discontinuity. Detected per query-source lineage, ignoring
  estimated token counts, surfaced on the Agents timeline as a boundary — not an
  error, since compaction is the agent working correctly. `postCompactionRegression()`
  reports whether the agent started re-reading what it had already seen.

  **Also**: `mcp.security.manifest.digest` fingerprints a tool's text surface, so
  a manifest rewritten after you trusted it reads as changed rather than merely
  scanning clean; `scoreGenAiCompleteness()` distinguishes a missing field from
  one the deployment cannot capture, with a `healthy`/`partial`/`unknown`/`invalid`
  verdict; `autotel doctor --capture` reports which surfaces a project can observe
  at all; and `autotel-mongoose` restores its Mongoose 8 peer range, which had
  been ratcheting with its devDependency while the README always said 8+.

## 0.3.1

### Patch Changes

- 0f518c6: Refresh dependencies to their latest minor and patch releases, most notably the
  OpenTelemetry SDK (`0.220.x` → `0.221.x`, `2.9.x` → `2.10.x`).

  Majors are deliberately held back for a separate change, including TypeScript 7,
  pnpm 11, chalk 6, jsdom 30 and the ESLint toolchain.

- 0f518c6: Stop publishing source maps. Every package is roughly half the size it was.

  Published output across all packages drops from 18.7 MiB to 7.9 MiB. Installing
  `autotel` downloads 500 KiB gzipped instead of 1,130 KiB. Nothing about the
  shipped JavaScript or type declarations changed.

  Source maps were 55–65% of every package, because each source byte was emitted
  four times: once as ESM, once as CJS, and again inside each format's map, which
  embedded `sourcesContent`. They never reached a consumer's application bundle —
  bundlers read maps and discard them — so the cost was pure install weight in
  exchange for TypeScript stack traces under `node --enable-source-maps`.

  Best-in-class TypeScript libraries do not make that trade. Of fourteen surveyed,
  twelve publish no maps at all (zod, hono, pino, fastify, vitest, vite, rollup,
  undici, commander, tsdown, react, astro), and not one publishes `.d.ts.map`.
  The OpenTelemetry packages do ship maps at around 50% of their size, which is
  the convention this repo had been following.

  The `.d.ts.map` declaration maps were broken regardless: `sourcesContent: false`
  with sources pointing at `../src/*.ts`, which `files` never published, so they
  resolved to nothing on a consumer's machine.

  Maps are still generated for local development. `tsconfig.json` keeps
  `sourceMap` and `declarationMap` on; only `tsconfig.build.json` disables them,
  so debugging the workspace is unchanged.

  This also fixes the bundle-size gate, which had been amplifying every ordinary
  change by 4×. The three packages that were failing it (`autotel-backends` +43.9%,
  `autotel-mcp` +14.4%, `autotel-schema` +12.0%) were not bloated — that growth was
  legitimate new backend code, quadrupled by the build. The baseline is
  regenerated.

## 0.3.0

### Minor Changes

- 3d9e31c: **Devtools UX upgrades:**

  - **Faceted service filter** on the Traces view — a "Filter" popover with per-service live counts and multi-select, plus click-to-filter service pills on each row.
  - **Context-window gauge** in the GenAI model header — a radial gauge showing prompt tokens vs the model's context window (green → amber → red as it fills), backed by a new per-model context-window lookup table.
  - **Live activity indicator** — the connection dot pulses when telemetry arrives and shows a rolling ingest rate (items/sec).
  - **Human-readable names** — camelCase/snake_case tool names get a readable Title Case tooltip.

  **Coding-agent observability** — model Claude Code's runtime environment:

  - `autotel-agents` now models `mcp_server_connection`, `plugin_loaded` and `hook_execution_complete` events (previously dropped to `other`): MCP server connect/disconnect lifecycle, loaded plugins, and hook-execution tallies, exposed on the session rollup and aggregate.
  - The Agents tab gains a **Runtime environment** section (MCP servers with connection status, plugins, hooks).
  - **Golden contract test + drift guard**: a sanitized, recorded Claude Code OTLP export is run through the real decode → reduce pipeline, and a test fails if Claude Code emits an event the adapter neither handles nor knowingly ignores. Re-record with `scripts/record-claude-otel.mjs`.

### Patch Changes

- 3d9e31c: Relicense from MIT to Apache-2.0. The `license` field now reads `Apache-2.0`, and the package ships the Apache-2.0 `LICENSE`. This changes the licence only; there are no API changes. Prior releases remain available under their original MIT terms. See `NOTICE` and `TRADEMARKS.md` in the repository root for attribution and the "autotel" trademark policy.

## 0.2.0

### Minor Changes

- 7c12332: Add first-class coding-agent observability, starting with Claude Code.
  - **New package `autotel-agents`** — a browser-safe domain layer that turns the OpenTelemetry metrics + log events coding agents emit into a session-centric model. Includes an adapter registry (Claude Code + opencode, by instrumentation scope / name prefix), pure session reducers (rollups kept indefinitely, raw timeline ring-buffered), MCP-aware tool parsing (`mcp__server__tool`), and a tool taxonomy that surfaces sub-agents (`Task`), skills (`Skill`), and tool categories. Cost is taken from the agent's reported `cost_usd` and estimated from tokens only as a fallback.
  - **`autotel-devtools`**:
    - New **Agents** tab — sessions list → per-session timeline + rollup, an aggregate strip across sessions, and breakdowns by tool category, MCP server, sub-agent, and skill. Prompts are private by default with a reveal/redact toggle.
    - The OTLP receiver now **parses metric data points** (Sum/Gauge/Histogram, JSON + protobuf) and **agent log events**, reconstructs sessions server-side, and streams them to the widget.
    - New **`npx autotel-devtools claude`** launcher subcommand that starts the receiver and launches Claude Code already wired to it (HTTP/protobuf, 1s export intervals, session id on metrics). `--print-env` emits the env block for MDM / VS Code; `--log-prompts` opts into prompt-text capture.
