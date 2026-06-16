# autotel-mongoose

## 10.1.0

### Minor Changes

- 4cd08bf: Trace dynamically-attached statics/methods and callback-style methods more
  faithfully.
  - **Callback-style custom methods** (Node convention: a trailing function
    argument, e.g. `doc.checkValidationErrors(cb)`) now keep their span open and
    active until the callback fires, and run the callback inside the span's
    context. Previously the span finalized on the synchronous return, so the
    method's real work — and any DB calls made inside the callback — were orphaned
    rather than nested under the method span.
  - **Compiled Models attached to a schema** (e.g. `schema.statics.Patches =
mongoose.model(...)`, the pattern used by history/audit plugins) are no longer
    wrapped. Wrapping a Model in a tracing function dropped its own statics
    (`find`, `create`, …) and broke callers; such Models are now skipped at both
    the compile-time scan and on later assignment.
  - **Statics / methods / query helpers added after instrumentation** (a late
    plugin, or an extension assigned after the model first compiles) are now
    wrapped via a write-trapping proxy on the schema collections, so tracing no
    longer depends on the order in which custom functions are attached relative to
    `instrumentMongoose()`.

## 10.0.0

### Patch Changes

- Updated dependencies [db0cce2]
  - autotel@4.0.0

## 9.0.0

### Patch Changes

- Updated dependencies [140fc76]
  - autotel@3.7.0

## 8.1.0

### Minor Changes

- d4b2b30: Automatically trace user-defined statics, instance methods, and query helpers (`schema.statics`, `schema.methods`, `schema.query`) — no manual `trace()` calls and no behavioral side effects. Each call gets an `INTERNAL` span named `mongoose.<Model>.<fn>` with `mongoose.method.*` / `code.function.name` attributes.

  New `customMethods` option controls this with per-category `include`/`exclude` selectors and parameter capture config. Configuration is resolved per Mongoose instance at call time, so a schema object reused across instances/connections honors each instance's own config.

  **Behavior change:** with no `customMethods` option, `instrumentMongoose()` now wraps all custom functions and captures their (redacted) arguments by default. Set `customMethods: false` to disable, or `customMethods: { captureParameters: false }` to keep call spans without serializing arguments. Note that custom-function arguments are often business payloads rather than DB filters, and the default redactor only masks known PII patterns (emails, phones, SSNs, cards).

## 8.0.0

### Patch Changes

- Updated dependencies [47a69ac]
  - autotel@3.6.0

## 7.0.0

### Patch Changes

- Updated dependencies [1c43d26]
- Updated dependencies [3ab5dc3]
  - autotel@3.5.0

## 6.0.0

### Patch Changes

- Updated dependencies [20a1186]
  - autotel@3.4.0

## 5.0.1

### Patch Changes

- 4ce86fc: Refresh package dependencies across the workspace and keep generated lockfile state in sync.

  Add OTLP/protobuf ingestion support to `autotel-devtools` for traces, logs, and metrics. The devtools HTTP receiver now accepts both OTLP/JSON and OTLP/protobuf payloads on the existing `/v1/traces`, `/v1/logs`, and `/v1/metrics` endpoints, decodes protobuf payloads with embedded OTLP schemas, and includes interop coverage using the OpenTelemetry protobuf serializers.

- Updated dependencies [4ce86fc]
  - autotel@3.3.1

## 5.0.0

### Patch Changes

- Updated dependencies [30a485b]
  - autotel@3.3.0

## 4.0.0

### Patch Changes

- Updated dependencies [9fbbc3a]
  - autotel@3.2.0

## 3.0.0

### Patch Changes

- Updated dependencies [614d414]
  - autotel@3.1.0

## 2.0.4

### Patch Changes

- 1a8bedd: Updated dependencies
- Updated dependencies [1a8bedd]
  - autotel@3.0.5

## 2.0.3

### Patch Changes

- 5e146a7: Streamline package surface and align skills with the [Agent Skills specification](https://agentskills.io/specification).
  - Drop `@tanstack/intent` from runtime and dev dependencies, plus the auto-generated `bin/intent.js` shims. Skills still ship under each package's `skills/` directory and are discovered by spec-compliant agents (Claude Code, Cursor, Cline, etc.) via filesystem scan — no consumer-side CLI required.
  - Remove the `autotel/workers` and `autotel/cloudflare` entry points from `autotel`. Cloudflare Workers users should import directly from `autotel-cloudflare` (and its `/logger`, `/sampling`, `/events` subpaths). `autotel` no longer peer-depends on `autotel-cloudflare` or `autotel-edge`.
  - Strip non-spec frontmatter (`type`, `library`, `library_version`, `sources`, `requires`) from all `SKILL.md` files; keep only spec-defined fields (`name`, `description`, optional `license`).
  - Move user-facing skills (`migrate-to-autotel`, `tune-sampling`, `debug-missing-spans`, `build-audit-trails`) into `packages/autotel/skills/` so consumers receive them automatically via npm. Contributor-only skills (`create-autotel-adapter`, `create-autotel-instrumentation`, `create-autotel-exporter`) remain under the repo-root `skills/` directory.
  - Realign `autotel`'s peer dependency ranges to match published versions on npm.
  - Release workflow now refreshes `pnpm-lock.yaml` after `changeset version` so the next Version Packages PR ships with a consistent lockfile.

- Updated dependencies [5e146a7]
  - autotel@3.0.3

## 2.0.2

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

- Updated dependencies [5999cb9]
  - autotel@3.0.2

## 2.0.1

### Patch Changes

- 5d05a3e: Add Cloudflare Workers support to main `autotel` package. Introduces `autotel/workers` and `autotel/cloudflare` entry points that re-export the functional API and Cloudflare-specific instrumentation from `autotel-cloudflare`, providing better DX for Cloudflare users while keeping the core package modular. Updates package exports, build config, and documentation.
- Updated dependencies [5d05a3e]
  - autotel@3.0.1

## 2.0.0

### Patch Changes

- Updated dependencies [b1f3704]
  - autotel@3.0.0

## 1.0.1

### Patch Changes

- dc4908d: Updated deps
- Updated dependencies [dc4908d]
  - autotel@2.26.3

## 1.0.0

### Patch Changes

- 8003fad: feat: migrate autotel-devtools into monorepo and upgrade to TypeScript 6.0
  - migrate `autotel-devtools` (standalone OTLP receiver + Preact web UI) into the monorepo with tsup server build and Vite IIFE widget build
  - add `devtools` support to `autotel.init()` for local `autotel-devtools` usage, including optional embedded startup and shutdown cleanup
  - improve `autotel-web` browser span export behavior by avoiding exporter recursion, feature-detecting `sendBeacon`, and reading HTTP methods from `Request` objects
  - narrow the `autotel-edge` factory marker fix to source code so downstream bundlers do not misoptimize required initializers
  - upgrade all packages to TypeScript 6.0: add `tsconfig.build.json` with `ignoreDeprecations: "6.0"` for tsup DTS generation, add explicit `"types": ["node"]` where missing, set `rootDir` where needed
  - fix Astro docs content collection config for Starlight loader API change
  - fix Playwright version mismatch between autotel-playwright and example-playwright-e2e
  - add `@tanstack/intent` to autotel runtime dependencies (required by published bin)

- Updated dependencies [8003fad]
  - autotel@2.26.0

## 0.0.2

### Patch Changes

- c5f8615: Fix mongoose hook instrumentation to properly handle callback-style hooks by preserving function arity and wrapping the `next` callback for span finalization. Also filter out additional internal Mongoose timestamp hooks to prevent double-wrapping.
