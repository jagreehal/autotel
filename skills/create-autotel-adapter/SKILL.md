---
name: create-autotel-adapter
description: >
  Create a new autotel framework adapter package — e.g. autotel-elysia,
  autotel-fastify, autotel-h3. Adapters wire request lifecycle, useLogger(),
  withAutotel handler wrapping, and async-safe context propagation through
  AsyncLocalStorage. Covers source layout, exports, tests, package.json
  setup, and registration in the monorepo.
type: create
library: autotel
license: MIT
---

# Create autotel framework adapter

Add a new built-in framework adapter to the autotel monorepo. Adapters are tiny — they delegate heavy lifting (span creation, request logger, error capture, drain pipeline) to the `autotel-adapters` toolkit and only contribute framework-specific glue.

## PR title

```
feat: add {name} adapter
```

## Touchpoints checklist

| # | File | Action |
| --- | --- | --- |
| 1 | `packages/autotel-{name}/src/index.ts` | Adapter exports |
| 2 | `packages/autotel-{name}/src/middleware.ts` | `withAutotel` middleware and context propagation |
| 3 | `packages/autotel-{name}/src/use-logger.ts` | `useLogger()` resolution |
| 4 | `packages/autotel-{name}/src/index.test.ts` | Unit tests |
| 5 | `packages/autotel-{name}/package.json` | Name, exports, peerDependency |
| 6 | `packages/autotel-{name}/tsconfig.json` | Extends `../../tsconfig.base.json` |
| 7 | `packages/autotel-{name}/tsup.config.ts` | Build entry |
| 8 | `packages/autotel-{name}/skills/autotel-{name}/SKILL.md` | Per-adapter skill |
| 9 | `packages/autotel/skills/autotel-frameworks/SKILL.md` | Add to framework list |
| 10 | `skills/index.json` | Add to skills manifest |
| 11 | `pnpm-workspace.yaml` | Confirm `packages/*` is included (usually no edit needed) |
| 12 | `bundle-size-baseline.json` | Run `pnpm bundle-size:update` once green |

**Important**: Do NOT consider the task complete until all 12 touchpoints pass.

## Naming conventions

Use these placeholders:

| Placeholder | Example (Elysia) | Usage |
| --- | --- | --- |
| `{name}` | `elysia` | File names, package suffix, scope |
| `{Name}` | `Elysia` | PascalCase types / function names |
| `{Framework}` | `Elysia` | Display name in docs |

Standard exports (use these exact names):

| Export | Shape |
| --- | --- |
| `withAutotel` | Middleware / handler wrapper |
| `useLogger` | Returns the request-scoped `ExecutionLogger` |
| `{name}Toolkit` | The adapter toolkit instance |

## Step 1: Adapter source

Read [references/adapter-template.md](references/adapter-template.md) for the full annotated template.

The contract is built on `createAdapterToolkit({ adapterName, enrich })` from `autotel-adapters`. You only contribute:

1. **`enrichFromContext(ctx)`** — extract `http.request.method`, `http.route`, `http.request.id` from the framework's request/event object.
2. **Middleware that calls `withAutotelEventHandler`** (or whatever shape the framework wants) and runs the handler under an `AsyncLocalStorage` so `useLogger()` works without an explicit argument.

Key rules:

- **No span code in the adapter.** Span lifecycle is owned by `trace()` — call it from inside the middleware.
- **No HTTP transport.** The adapter never talks to a backend; that's the SDK's job.
- **No bespoke config.** Use `resolveAdapterConfig()` from `autotel-adapters/core` for any tunable.
- **Async-safe `useLogger()`.** Wire an `AsyncLocalStorage<ExecutionLogger>` so `useLogger()` works deep inside async work without prop-drilling.

## Step 2: Tests

Read [references/test-template.md](references/test-template.md). Cover:

- `useLogger()` outside a request throws with a clear "wrap with withAutotel" message.
- `useLogger()` inside a request returns the active logger.
- Spans get `http.request.method` + `http.route` attributes.
- Errors thrown in the handler are recorded on the span (`span.status = ERROR`, `exception.message` set).
- `log.fork()` works inside the middleware (`_parentCorrelationId` propagated).

## Step 3: package.json

```jsonc
{
  "name": "autotel-{name}",
  "version": "0.0.1",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "type-check": "tsc --noEmit"
  },
  "peerDependencies": {
    "autotel": "workspace:*",
    "autotel-adapters": "workspace:*",
    "{framework-package}": "*"
  },
  "devDependencies": {
    "tsup": "*",
    "vitest": "*",
    "{framework-package}": "*"
  }
}
```

## Step 4: tsup.config.ts

```typescript
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  clean: true,
})
```

## Step 5: Per-adapter skill

Create `packages/autotel-{name}/skills/autotel-{name}/SKILL.md`. Use the existing per-package skills as templates (see `packages/autotel-hono/skills/autotel-hono/SKILL.md`).

## Step 6: Register in monorepo

- Add a row to `packages/autotel/skills/autotel-frameworks/SKILL.md` framework table.
- Add the new package to `skills/index.json` so `npx skills add` discovers it.
- Run `pnpm install` to relink.

## Step 7: Verify

```bash
pnpm --filter autotel-{name} run build
pnpm --filter autotel-{name} run test
pnpm --filter autotel-{name} run type-check
pnpm intent:validate
pnpm bundle-size:update     # only if size grew intentionally
```

## Anti-patterns

| Anti-pattern | Fix |
| --- | --- |
| Adapter creates spans manually | Use `trace()` — auto-naming, auto-status |
| Adapter calls `fetch` to a backend | That's exporter territory, not adapter |
| `useLogger(req)` only — no zero-arg form | Wire an `AsyncLocalStorage` so `useLogger()` works without args |
| Bespoke env var handling | `resolveAdapterConfig` handles it uniformly |
| Adapter swallows handler errors | Re-throw after recording the exception so the framework's own handler runs |
| No test for `log.fork()` propagation | Add one — adapters routinely break parent correlation |
