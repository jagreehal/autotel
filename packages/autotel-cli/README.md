# autotel-cli

CLI for autotel — setup wizard, diagnostics, and incremental features.

Designed for **both humans and AI agents**: every command supports `--json`,
errors are returned as a structured envelope with stable `AUTOTEL_E_*` codes,
and the binary describes itself via `autotel schema`.

For agents: see [`SKILL.md`](./SKILL.md) for the one-command bootstrap.

## Installation

```bash
npm install -g autotel-cli
# or
npx autotel <command>
```

## Commands

### `autotel init`

Interactive setup wizard to initialize autotel in your project.

```bash
# Interactive mode
npx autotel init

# Use defaults (local backend, all auto-instrumentations)
npx autotel init --yes

# Use a quick preset
npx autotel init --preset node-datadog-pino

# Dry run - see what would be created
npx autotel init --dry-run
```

By default `autotel init` **scans your package.json** (and the workspace root
if you're in a monorepo) and proposes a plan: which presets to wire, which
packages to install, which env vars you'll need. Detected loggers, web
frameworks, MCP servers, Sentry, Cloudflare, etc. are wired automatically;
deps covered by `@opentelemetry/auto-instrumentations-node` (Express,
Fastify, NestJS, Next.js, pg, redis, …) are listed but not wired
individually.

**Options:**

| Flag | What it does |
| --- | --- |
| `--yes, -y` | Auto-apply detected items; no prompts |
| `--preset <name>` | Use a named quick preset (skips detection) |
| `--dry-run` | Print plan; write nothing |
| `--no-install` | Generate files only; print install command |
| `--force` | Overwrite a hand-edited instrumentation file (backup written) |
| `--no-detect` | Skip auto-detection; requires `--plan`, `--input`, or `--preset` |
| `--detect-only` | Print the detected plan and exit |
| `--plan <path>` | Apply a pre-built `InitPlan` JSON file |
| `--input -` / `--input <path>` | Read `InitPlan` JSON from stdin or a file |
| `--scan-env` | Consent to reading `.env` / `.env.local` for backend detection |
| `--json` | Machine-readable JSON instead of human output |
| `--output-file <path>` | Persist JSON output to a file |
| `--no-secrets-in-output` | Redact secret-shaped values (`*KEY*`, `*TOKEN*`, etc.) |
| `--no-interactive` | Fail fast instead of prompting |

**Detection coverage:**

- **Frameworks (auto-wired):** Hono, MCP servers/clients, TanStack Start
- **Frameworks (via `auto-instrumentations-node`):** Express, Fastify, NestJS, Next.js, pg, mysql/2, redis, ioredis, GraphQL, AWS SDK
- **Loggers:** Pino (first-class — `init({ logger })`), Winston/Bunyan (auto-instrumented)
- **Subscribers:** PostHog, Mixpanel, Amplitude, Segment, Slack
- **Plugins:** Mongoose, Drizzle, Sentry
- **Platforms:** Cloudflare (from `wrangler.toml`), AWS Lambda, Edge
- **Backends from env vars:** `DD_API_KEY` → Datadog, `HONEYCOMB_API_KEY` → Honeycomb, `OTEL_EXPORTER_OTLP_ENDPOINT` → OTLP

**Quick presets:**
- `node-datadog-pino` - Node.js + Datadog + Pino logging
- `node-datadog-agent` - Node.js + Datadog Agent (local development)
- `node-honeycomb` - Node.js + Honeycomb
- `node-otlp` - Node.js + Generic OTLP endpoint

### Agent-native discovery

```bash
autotel schema              # Full command manifest with side-effect metadata
autotel schema errors       # Error envelope shape + AUTOTEL_E_* codes
autotel schema outputs      # JSON output shapes per command
autotel commands            # Compact one-line-per-command listing
autotel examples [name]     # Copy-pasteable examples
autotel version             # Version + runtime info as JSON
```

All output is JSON. Errors are returned as:

```json
{
  "ok": false,
  "command": "autotel init",
  "error": {
    "type": "validation",
    "code": "AUTOTEL_E_NO_PACKAGE_JSON",
    "message": "No package.json found at ...",
    "retryable": false,
    "fix": "cd into a directory with a package.json, or pass --cwd <path>",
    "expected": { "file": "package.json" }
  }
}
```

Exit codes: `0` success, `1` runtime failure, `2` validation/conflict.

### `autotel doctor`

Run diagnostics on your autotel setup.

```bash
# Run all checks
npx autotel doctor

# Output as JSON
npx autotel doctor --json

# Auto-fix resolvable issues
npx autotel doctor --fix

# List available checks
npx autotel doctor --list-checks
```

**Options:**
- `--json` - Output machine-readable JSON
- `--fix` - Auto-fix resolvable issues
- `--list-checks` - List all available checks
- `--env-file <path>` - Specify env file to check

**Exit codes:**
- `0` - All checks passed
- `1` - Warnings found
- `2` - Errors found

### `autotel add <type> <name>`

Add a backend, subscriber, plugin, or platform incrementally.

```bash
# Add Datadog backend
npx autotel add backend datadog

# Add PostHog event subscriber
npx autotel add subscriber posthog

# Add Mongoose plugin
npx autotel add plugin mongoose

# List all available presets
npx autotel add --list

# List backends only
npx autotel add backend --list

# Show help for a specific preset
npx autotel add backend datadog --help
```

**Types:**
- `backend` - Telemetry backends (Datadog, Honeycomb, OTLP, etc.)
- `subscriber` - Event subscribers (PostHog, Mixpanel, Segment, Slack, etc.)
- `plugin` - Database/ORM plugins (Mongoose, Drizzle, etc.)
- `platform` - Platform support (AWS Lambda, Cloudflare Workers, etc.)

**Options:**
- `--list` - List available presets
- `--dry-run` - Skip installation and print what would be done
- `--force` - Overwrite non-CLI-owned config (creates backup first)

### `autotel codemod trace <path>`

Wrap functions in `trace()` with a span name derived from the function/variable/method name. Use this to adopt autotel on existing code without changing function bodies.

**Supported file types:** `.ts`, `.tsx`, `.js`, `.jsx`

```bash
# Single file (TypeScript or JavaScript)
npx autotel codemod trace src/index.ts
npx autotel codemod trace src/utils.js

# Glob pattern - TypeScript only
npx autotel codemod trace "src/**/*.ts"

# Glob pattern - all supported files
npx autotel codemod trace "src/**/*.{ts,tsx,js,jsx}"

# Dry run - print what would change without writing
npx autotel codemod trace "src/**/*.ts" --dry-run

# Custom span name template: {name}, {file} (basename), {path} (relative)
npx autotel codemod trace "src/**/*.ts" --name-pattern "{file}.{name}"

# Skip functions whose name matches a regex (repeatable)
npx autotel codemod trace "src/**/*.ts" --skip "^_" --skip "test|mock"

# Print per-file summary (wrapped count, skipped)
npx autotel codemod trace "src/**/*.ts" --print-files
```

**Options:**

- `--dry-run` - Print changes without writing files
- `--name-pattern <pattern>` - Span name template. Placeholders: `{name}`, `{file}`, `{path}`. Default: `{name}` only.
- `--skip <regex>...` - Skip functions whose name matches (repeatable; combined as OR).
- `--print-files` - Print per-file summary (e.g. `✔ path (N wrapped)`, `↷ path (skipped: reason)`).

**Supported patterns:** Function declarations, arrow/function expressions in `const`/`let`/`var`, class and static methods (body wrap), object method shorthand, named default export function. Works with both TypeScript and JavaScript files. Span name defaults to function/variable/method name (or `ClassName.methodName` for methods).

**Exclusions:** Generator functions (`function*`, `async function*`); getters/setters; constructors; CJS (`require('autotel')`); anonymous default export; class/object methods that use `super` in the body; `.d.ts` files; `node_modules/`. The codemod does not modify files when no eligible functions are found (no unused `trace` import added). The `{path}` placeholder uses the relative path from `--cwd` with forward slashes; moving files will change span names.

## Global Options

All commands support these options:

- `--cwd <path>` - Target directory (default: current working directory)
- `--verbose` - Show detailed output
- `--quiet` - Only show warnings and errors

## Package Manager Detection

The CLI automatically detects your package manager from the nearest lockfile:

1. `pnpm-lock.yaml` → pnpm
2. `bun.lockb` → bun
3. `yarn.lock` → yarn
4. `package-lock.json` → npm

Fallback: npm if no lockfile found.

## Monorepo Support

The CLI detects workspace roots and handles installation correctly:

```bash
# Install at package root (default)
npx autotel init --cwd ./packages/my-app

# Install at workspace root
npx autotel init --cwd ./packages/my-app --workspace-root
```

## Generated Files

### `src/instrumentation.mts`

The CLI generates an instrumentation file with clear section markers:

```typescript
/**
 * autotel instrumentation - managed by autotel-cli
 * Run `autotel add <feature>` to update this file
 */
import 'autotel/register';
import { init } from 'autotel';

// --- AUTOTEL:BACKEND ---
import { createDatadogConfig } from 'autotel-backends/datadog';

init({
  // --- AUTOTEL:BACKEND_CONFIG ---
  ...createDatadogConfig({
    apiKey: process.env.DATADOG_API_KEY,
  }),
});
```

### `.env.example`

Environment variable template based on selected presets:

```bash
# Autotel configuration
# Copy to .env and fill in values

# Datadog API key for authentication
# ⚠️ SENSITIVE: Do not commit this value
DATADOG_API_KEY=your-api-key
```

## Starting Your App

After running `autotel init`, start your app with the `--import` flag:

```bash
# Node.js ESM
node --import ./src/instrumentation.mts dist/index.js

# With tsx (development)
tsx --import ./src/instrumentation.mts src/index.ts
```

Or add it to your `package.json` scripts:

```json
{
  "scripts": {
    "start": "node --import ./src/instrumentation.mjs dist/index.js",
    "dev": "tsx --import ./src/instrumentation.mts src/index.ts"
  }
}
```

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run tests
pnpm test

# Type check
pnpm typecheck
```

## License

Apache-2.0
