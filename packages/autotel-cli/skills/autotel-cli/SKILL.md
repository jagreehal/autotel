---
name: autotel-cli
description: >
  Use this skill when running autotel CLI commands to set up, configure, or extend OpenTelemetry instrumentation in a Node.js project — including init, doctor, add, and codemod trace.
type: core
library: autotel-cli
library_version: "0.8.2"
sources:
  - jagreehal/autotel:packages/autotel-cli/README.md
---

# autotel-cli

CLI for autotel: interactive setup wizard, diagnostics, incremental feature addition, and a codemod to adopt tracing on existing code. Targets Node.js 18+.

## Setup

```bash
# One-off use (no global install needed)
npx autotel <command>

# Or install globally
npm install -g autotel-cli
```

## Commands

### `autotel init`

Interactive wizard that writes an instrumentation file and installs dependencies.

```bash
# Interactive (prompts for backend, plugins, etc.)
npx autotel init

# Non-interactive: accept all defaults (local backend, all auto-instrumentations)
npx autotel init --yes

# Use a named quick preset
npx autotel init --preset node-datadog-pino

# Preview what would happen without writing files
npx autotel init --dry-run
```

**Quick presets:** `node-datadog-pino`, `node-datadog-agent`, `node-honeycomb`, `node-otlp`

**Key options:**

| Option | Effect |
|---|---|
| `--yes / -y` | Non-interactive, accept defaults |
| `--preset <name>` | Use a quick preset |
| `--dry-run` | Print what would be done, no writes or installs |
| `--no-install` | Generate files only, skip package installation |
| `--print-install-cmd` | Output the install command instead of running it |
| `--force` | Overwrite existing config (backs up the old file first) |
| `--workspace-root` | Install at monorepo workspace root instead of package root |

Generated files:
- `src/instrumentation.mts` (or `.mjs`) — the instrumentation entry point with section markers
- `.env.example` — env var template based on selected presets (written only if file does not exist)

After init, start your app with `--import`:

```bash
# Node.js ESM
node --import ./src/instrumentation.mts dist/index.js

# With tsx (development)
tsx --import ./src/instrumentation.mts src/index.ts
```

---

### `autotel doctor`

Diagnose the current autotel setup.

```bash
npx autotel doctor             # Run all checks, human-readable output
npx autotel doctor --json      # Machine-readable JSON
npx autotel doctor --fix       # Auto-fix resolvable issues
npx autotel doctor --list-checks  # Show all available check names
npx autotel doctor --env-file .env.production  # Check a specific env file
```

Exit codes: `0` = all passed, `1` = warnings, `2` = errors.

---

### `autotel add <type> <name>`

Incrementally add a backend, subscriber, plugin, or platform to an existing instrumentation file.

```bash
# List all available presets
npx autotel add --list

# List backends only
npx autotel add backend --list

# Add Datadog backend
npx autotel add backend datadog

# Add a PostHog event subscriber
npx autotel add subscriber posthog

# Add Mongoose plugin
npx autotel add plugin mongoose

# Show help for a specific preset (packages, env vars, next steps)
npx autotel add backend datadog --help
```

**Preset types:**

| Type | Examples |
|---|---|
| `backend` | `datadog`, `honeycomb`, `otlp`, `local` |
| `subscriber` | `posthog`, `mixpanel`, `segment`, `slack` |
| `plugin` | `mongoose`, `drizzle` |
| `platform` | AWS Lambda, Cloudflare Workers |

**Key options:** `--dry-run`, `--no-install`, `--force`, `--json` (for `--list`).

`add` is idempotent: if the package is already installed and the instrumentation file already contains the feature, it exits cleanly with `[OK]`.

`add` requires an existing CLI-owned instrumentation file (created by `autotel init`). Use `--force` to modify a user-created file.

---

### `autotel codemod trace <path>`

Wrap existing functions in `trace()` calls, deriving span names from the function or variable name. Use this to adopt tracing on existing code without manual edits.

```bash
# Single file
npx autotel codemod trace src/index.ts

# Glob (quote to prevent shell expansion)
npx autotel codemod trace "src/**/*.ts"

# All supported types
npx autotel codemod trace "src/**/*.{ts,tsx,js,jsx}"

# Dry run — preview changes without writing
npx autotel codemod trace "src/**/*.ts" --dry-run

# Custom span name: {name}, {file} (basename), {path} (relative from --cwd)
npx autotel codemod trace "src/**/*.ts" --name-pattern "{file}.{name}"

# Skip functions matching a regex (repeatable, combined as OR)
npx autotel codemod trace "src/**/*.ts" --skip "^_" --skip "test|mock"

# Print per-file summary
npx autotel codemod trace "src/**/*.ts" --print-files
```

**What gets wrapped:** function declarations, arrow/function expressions in `const`/`let`/`var`, class and static methods, object method shorthand, named default export functions.

**Never wrapped:** generator functions, getters/setters, constructors, `super` usage in body, anonymous default exports, `.d.ts` files, `node_modules/`, files that already use `require('autotel')`.

## Configuration Patterns

### Global options (all commands)

```bash
--cwd <path>   # Target directory (default: cwd)
--verbose      # Show detailed output
--quiet        # Only show warnings and errors
```

### Package manager detection

Detected automatically from the nearest lockfile in this order:
1. `pnpm-lock.yaml` → pnpm
2. `bun.lockb` → bun
3. `yarn.lock` → yarn
4. `package-lock.json` → npm

Fallback: npm.

### Monorepo usage

```bash
# Install into a specific workspace package
npx autotel init --cwd ./packages/my-app

# Install at workspace root (shared instrumentation)
npx autotel init --cwd ./packages/my-app --workspace-root
```

### Generated instrumentation file structure

The CLI uses section markers to allow `autotel add` to safely modify the file:

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
  ...createDatadogConfig({ apiKey: process.env.DATADOG_API_KEY }),
  // --- AUTOTEL:SUBSCRIBERS_CONFIG ---
  subscribers: [],
});

// --- AUTOTEL:PLUGIN_INIT ---
```

Do not remove these markers if you want `autotel add` to continue working on the file.

## Common Mistakes

### HIGH — Forgetting `--import` when starting the app

```bash
# Wrong: instrumentation never runs
node dist/index.js

# Correct: register instrumentation before app code loads
node --import ./src/instrumentation.mts dist/index.js
```

The instrumentation file must be loaded before any other module. The `--import` flag (Node.js 18.19+) is the correct mechanism. `require` or a top-level import inside app code is too late.

### HIGH — Running `autotel add` before `autotel init`

```bash
# Wrong: no instrumentation file exists yet
npx autotel add plugin mongoose

# Correct: create the file first
npx autotel init
npx autotel add plugin mongoose
```

`add` reads and modifies the existing instrumentation file. It will fail if the file does not exist or is not CLI-owned (use `--force` for user-created files).

### MEDIUM — Globbing without quotes

```bash
# Wrong: shell expands the glob before the CLI sees it
npx autotel codemod trace src/**/*.ts

# Correct: quote the glob so the CLI handles expansion
npx autotel codemod trace "src/**/*.ts"
```

### MEDIUM — Using `--force` on init without understanding the backup

`--force` on `init` overwrites an existing instrumentation file but creates a `.bak` backup first. The backup path is logged at `--verbose` level. If you ran `--force` accidentally, check for `instrumentation.mts.bak` in the same directory.

### MEDIUM — Using `--dry-run` and expecting installs to have run

`--dry-run` implies `--no-install` and `--print-install-cmd`. No files are written and no packages are installed. It is purely a preview mode.

## Version

Targets autotel-cli v0.8.2. Node.js >= 18.0.0 required (18.19+ for `--import` flag support).
