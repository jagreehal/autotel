# autotel-message-contract

## 15.0.0

### Patch Changes

- Updated dependencies [29546bf]
  - autotel@7.4.0

## 14.0.0

### Patch Changes

- Updated dependencies [78c7131]
  - autotel@7.3.0

## 13.0.0

### Patch Changes

- Updated dependencies [7a2f38c]
  - autotel@7.2.0

## 12.0.0

### Patch Changes

- Updated dependencies [559ec46]
  - autotel@7.1.0

## 11.0.1

### Patch Changes

- Updated dependencies [4c859aa]
  - autotel@7.0.1

## 11.0.0

### Patch Changes

- Updated dependencies [d303348]
  - autotel@7.0.0

## 10.0.0

### Patch Changes

- Updated dependencies [e8f2d0f]
  - autotel@6.5.0

## 9.0.1

### Patch Changes

- Updated dependencies [b37813b]
  - autotel@6.4.1

## 9.0.0

### Patch Changes

- Updated dependencies [09888cd]
  - autotel@6.4.0

## 8.0.0

### Patch Changes

- Updated dependencies [fb6bee2]
  - autotel@6.3.0

## 7.0.1

### Patch Changes

- Updated dependencies [7bad202]
  - autotel@6.2.1

## 7.0.0

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

- Updated dependencies [0f518c6]
- Updated dependencies [0f518c6]
- Updated dependencies [0f518c6]
  - autotel@6.2.0

## 6.0.0

### Patch Changes

- Updated dependencies [85a0e88]
  - autotel@6.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [756345d]
- Updated dependencies [756345d]
  - autotel@6.0.0

## 4.0.0

### Patch Changes

- Updated dependencies [9030f83]
  - autotel@5.0.0

## 3.0.0

### Patch Changes

- Updated dependencies [4f4f074]
- Updated dependencies [4f4f074]
  - autotel@4.3.0

## 2.0.5

### Patch Changes

- 3d9e31c: Relicense from MIT to Apache-2.0. The `license` field now reads `Apache-2.0`, and the package ships the Apache-2.0 `LICENSE`. This changes the licence only; there are no API changes. Prior releases remain available under their original MIT terms. See `NOTICE` and `TRADEMARKS.md` in the repository root for attribution and the "autotel" trademark policy.
- Updated dependencies [3d9e31c]
  - autotel@4.2.5

## 2.0.4

### Patch Changes

- Updated dependencies [4b7ad78]
  - autotel@4.2.4

## 2.0.3

### Patch Changes

- Updated dependencies [830b6a4]
  - autotel@4.2.3

## 2.0.2

### Patch Changes

- Updated dependencies [0b1e332]
  - autotel@4.2.2

## 2.0.1

### Patch Changes

- Updated dependencies [38ae023]
  - autotel@4.2.1

## 2.0.0

### Patch Changes

- ec47ec8: Google Secure AI Agents observability plus MCP protocol-boundary security observability — additive defense-in-depth across planning, tool use, MCP traffic, triage, and UI surfaces.

  **autotel-mcp-instrumentation**
  - Annotation hints captured as `mcp.tool.*` span attributes (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`, `untrustedContentHint`) to surface malicious-manifest vectors and tool trust profiles.
  - Payload-size signals (`mcp.tool.arguments.size` / `mcp.tool.result.size`) for token-exhaustion and contaminated-output detection without logging content.
  - Output character budgets (`outputCharBudget` + `MCP_CHAR_BUDGETS`) that emit `mcp.security.budget_exceeded` signals and can bridge to unified `security.*` events.
  - Pluggable injection classifier (`securityClassifier`) scanning arguments and results on both client and server, recording `mcp.security.injection.*` signals and bridging suspicious verdicts to `security.*` events without breaking traced calls.
  - `heuristicInjectionClassifier()` as a dependency-free first-pass detector.
  - `spotlight()` to delimit/base64 untrusted content across Node and edge runtimes.
  - `validateToolBudget()` for WebMCP-style text-surface limits.
  - Guard bridge via `guard` config so MCP tool calls count against an `autotel-genai` guard.
  - `applyManifestAssessment()` bridges suspicious manifest verdicts to unified `security.*` events when `bridgeSecurityEvents` is enabled.
  - New `mcp.security.events` counter and `autotel-mcp-instrumentation/security` subpath export.

  **autotel-cli**
  - Add `autotel security mcp` to aggregate MCP security signals: injection verdicts, output-budget breaches, and untrusted-content tool calls.

  **autotel-genai/agent**
  - `AgentPlanClassifier` + `runAgentPlanClassifier()` / `recordPlanRiskAssessment()` with `agent.plan.risk.*` attrs and optional `llm.plan.risk.elevated` security event.
  - `heuristicPlanRiskClassifier()` as a dependency-free first-pass plan-risk tripwire.
  - Export `agentContextFromSpan()` from the agent subpath.

  **autotel-audit**
  - Passive action-chain processor emits `llm.action_chain.suspicious` and stamps unified `security.*` attributes on the destructive span.
  - `llm.manifest.suspicious` and `llm.plan.risk.elevated` added to the suggested security event catalogue.

  **autotel-cloudflare/agents**
  - `tool:approval` events use `recordHumanApproval()` (optional `autotel-genai` peer dependency).

  **autotel-devtools**
  - Agent timeline surfaces consent, policy, injection, guard, security-event, and plan-step badges from the new agent security attributes.

  **autotel-schema**
  - Agent security contract snapshot extended with `agent.plan.risk.*` attributes.

  **autotel**
  - Core `security-schema` remains the shared sink for unified `security.*` events consumed by the agent and MCP observability layers.

  **Packaging**
  - Drop the duplicated `src/` directory from published tarballs across all packages. The shipped `.js.map` sourcemaps already embed original source via `sourcesContent`, so source-level debugging is unchanged while install footprint shrinks ~20–30%.

- Updated dependencies [ec47ec8]
  - autotel@4.2.0

## 1.0.0

### Patch Changes

- Updated dependencies [12c6b6d]
  - autotel@4.1.0

## 0.2.0

### Minor Changes

- 4cd08bf: Add **`autotel-message-contract`**, brokerless message contract testing. An
  optional, standalone, test-time package adjacent to autotel's
  observability-contract pair (`autotel-schema`, the telemetry contract you emit;
  `autotel-pact`, evidence that contracted interactions actually ran). It extends
  the idea beyond telemetry to serialized payload compatibility across versions,
  and needs no runtime observability to be useful (`autotel` is an optional peer).

  Pin the serialized shape of the messages your code sends and stores (events,
  commands, queue payloads, HTTP bodies) and prove old and new versions stay
  compatible, as ordinary unit tests with the contract committed as an approved
  file beside the test. No broker, no schema registry, nothing to run in Docker.
  - `messageContract().given(msg).whenSerialized().thenContractIsUnchanged()`:
    snapshot the serialized output using your app's own serializer; fail with a
    diff when the shape drifts. Update with `AUTOTEL_CONTRACT_UPDATE=1`.
  - `.whenDeserializedAs(reader).thenBackwardCompatible()` / `.thenForwardCompatible()`:
    prove a newer reader still reads older bytes, and a reader is a
    Standard Schema (Zod/Valibot/ArkType) or a plain parse function.
  - `autotel-message-contract/serializer`: the `MessageSerializer` interface and a
    deterministic `jsonSerializer`; pass your own to pin the exact bytes you ship.

  The package covers message serialization only. For type or API surface pinning,
  use a dedicated tool like api-extractor.
