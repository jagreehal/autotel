---
name: autotel-cli
description: >
  Runs the autotel CLI to set up, diagnose, extend, and score OpenTelemetry
  instrumentation in a Node.js project: init, doctor, add, map, and codemod trace.
  Use this skill when installing autotel from the command line, diagnosing a setup
  that is not exporting, or adding a backend, subscriber, or plugin. Do not use for
  acting on an observability score in detail — use skill find-observability-gaps —
  or for querying telemetry from a running service, which skill analyze-traces
  covers.
---

# autotel-cli

CLI for autotel: detection-driven setup, diagnostics, incremental feature addition, an observability score, and a codemod to adopt tracing on existing code. The npm package is `autotel-cli`; the binary it installs is `autotel`. Requires Node.js >= 22.

## Setup

```bash
# No install needed (package name)
npx autotel-cli <command>

# Pin it in the project instead of installing globally, so every run and every
# machine gets the same version
pnpm add -D autotel-cli
pnpm exec autotel <command>   # after install the binary is `autotel`
```

Examples below use `npx autotel-cli`; once installed, `autotel <command>` is the same thing.

## Commands

### `autotel init`

Detects your dependencies (loggers, libraries, backend hints), builds a plan, asks you to confirm it, then writes an instrumentation file and installs packages.

```bash
# Detect, preview the plan, confirm
npx autotel-cli init

# Accept the detected plan without the confirmation prompt
npx autotel-cli init --yes

# Agents / CI: never prompt (fails instead), JSON result envelope
npx autotel-cli init --no-interactive --json

# Print the detected plan and write nothing
npx autotel-cli init --detect-only

# Apply a pre-built InitPlan JSON file (or `--input -` for stdin)
npx autotel-cli init --plan ./autotel-plan.json

# Use a named quick preset
npx autotel-cli init --preset node-datadog-pino

# Preview what would happen without writing files
npx autotel-cli init --dry-run
```

**Quick presets:** `node-datadog-pino`, `node-datadog-agent`, `node-honeycomb`, `node-otlp`, `node-google-cloud`

**Key options:**

| Option                | Effect                                                                         |
| --------------------- | ------------------------------------------------------------------------------ |
| `--yes / -y`          | Accept the detected plan without prompting                                     |
| `--no-interactive`    | Never prompt; fail if input would be required                                  |
| `--json`              | Emit a machine-readable JSON envelope (with `--dry-run`: plan only, no writes) |
| `--detect-only`       | Run detection, print the plan, write nothing                                   |
| `--plan <path>`       | Apply a pre-built InitPlan JSON file                                           |
| `--input <path>`      | Read InitPlan JSON from a file or stdin (`-`)                                  |
| `--no-detect`         | Skip detection (then `--plan`, `--input` or `--preset` is required)            |
| `--scan-env`          | Allow reading `.env` / `.env.local` keys for backend detection                 |
| `--preset <name>`     | Use a quick preset                                                             |
| `--dry-run`           | Print what would be done, no writes or installs                                |
| `--no-install`        | Generate files only, skip package installation                                 |
| `--print-install-cmd` | Output the install command instead of running it                               |
| `--force`             | Overwrite existing config (backs up the old file first)                        |
| `--workspace-root`    | Install at monorepo workspace root instead of package root                     |

Generated files:

- `src/instrumentation.mts` (`.mjs` in a JS project; at the package root if there is no `src/`): the instrumentation entry point with section markers
- `.env.example`: env var template based on selected presets (written only if file does not exist)

After init, start your app with `--import`:

```bash
# Node.js ESM (loading a .mts file directly needs Node 22.18+ type stripping;
# otherwise use tsx or compile it)
node --import ./src/instrumentation.mts dist/index.js

# With tsx (development)
tsx --import ./src/instrumentation.mts src/index.ts
```

---

### `autotel doctor`

Diagnose the current autotel setup.

```bash
npx autotel-cli doctor             # Run all checks, human-readable output
npx autotel-cli doctor --json      # Machine-readable JSON
npx autotel-cli doctor --fix       # Auto-fix resolvable issues
npx autotel-cli doctor --list-checks  # Show all available check names
npx autotel-cli doctor --env-file .env.production  # Check a specific env file
npx autotel-cli doctor --capture   # Which capture surfaces this project can observe
```

Exit codes: `0` = all passed, `1` = warnings, `2` = errors.

`doctor` checks the setup. `map` checks the code. Run both.

---

### `autotel map`

Score the observability of every entry point. Static analysis of the source: nothing runs, nothing leaves the machine.

```bash
npx autotel-cli map                              # score + the three to fix first
npx autotel-cli map --all                        # every entry point as a matrix
npx autotel-cli map src/routes/checkout.ts       # one entry point and its fixes
npx autotel-cli map --json --no-write            # every finding with evidence + fix
npx autotel-cli map --min-score 70               # exit 1 below the threshold
npx autotel-cli map --baseline git:origin/main   # exit 1 when a check regresses
npx autotel-cli map --format github --limit 10   # GitHub Actions annotations on the PR diff
```

Writes `autotel.map.json` next to `package.json`; commit it so `--baseline` has something to compare against. For the checks, scoring, and waiver comments, use skill `find-observability-gaps`.

---

### `autotel add <type> <name>`

Incrementally add a backend, subscriber, plugin, or platform to an existing instrumentation file.

```bash
# List all available presets
npx autotel-cli add --list

# List backends only
npx autotel-cli add backend --list

# Add Datadog backend (direct OTLP; use datadog-agent for a local agent)
npx autotel-cli add backend datadog

# Add a PostHog event subscriber
npx autotel-cli add subscriber posthog

# Add Mongoose plugin
npx autotel-cli add plugin mongoose

# Show help for a specific preset (packages, env vars, next steps)
npx autotel-cli add backend datadog --help
```

**Preset types:**

| Type         | Examples                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| `backend`    | `datadog`, `datadog-agent`, `honeycomb`, `google-cloud`, `otlp-http`, `otlp-grpc`, `local`                         |
| `subscriber` | `posthog`, `mixpanel`, `amplitude`, `segment`, `slack`, `webhook`                                                  |
| `plugin`     | `mongoose`, `drizzle`, `hono`, `nestjs`, `elysia`, `sveltekit`, `nuxt`, `tanstack`, `mcp`, `sentry`, `posthog-web` |
| `platform`   | `aws-lambda`, `cloudflare`, `edge`                                                                                 |

There is no plain `otlp` slug: use `otlp-http` or `otlp-grpc`. Run `add <type> --list` for the current set.

**Key options:** `--dry-run`, `--print-install-cmd`, `--force`, `--yes`, `--workspace-root`, `--json` (for `--list`).

`add` is idempotent: if the package is already installed and the instrumentation file already contains the feature, it exits cleanly with `[OK]`.

`add` requires an existing CLI-owned instrumentation file (created by `autotel init`). Use `--force` to modify a user-created file.

---

### `autotel codemod trace <path>`

Wrap existing functions in `trace()` calls, deriving span names from the function or variable name. Use this to adopt tracing on existing code without manual edits.

```bash
# Single file
npx autotel-cli codemod trace src/index.ts

# Glob (quote to prevent shell expansion)
npx autotel-cli codemod trace "src/**/*.ts"

# All supported types
npx autotel-cli codemod trace "src/**/*.{ts,tsx,js,jsx}"

# Dry run — preview changes without writing
npx autotel-cli codemod trace "src/**/*.ts" --dry-run

# Custom span name: {name}, {file} (basename), {path} (relative from --cwd)
npx autotel-cli codemod trace "src/**/*.ts" --name-pattern "{file}.{name}"

# Skip functions matching a regex (repeatable, combined as OR)
npx autotel-cli codemod trace "src/**/*.ts" --skip "^_" --skip "test|mock"

# Print per-file summary
npx autotel-cli codemod trace "src/**/*.ts" --print-files
```

**What gets wrapped:** function declarations, arrow/function expressions in `const`/`let`/`var`, class and static methods, object method shorthand, named default export functions.

**Never wrapped:** generator functions, getters/setters, constructors, methods that use `super`, anonymous default exports, functions already wrapped in `trace()`, `.d.ts` files, `node_modules/`.

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
npx autotel-cli init --cwd ./packages/my-app

# Install at workspace root (shared instrumentation)
npx autotel-cli init --cwd ./packages/my-app --workspace-root
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
  autoInstrumentations: ['http', 'pino'],
  // --- AUTOTEL:BACKEND_CONFIG ---
  ...createDatadogConfig({
    apiKey: process.env.DATADOG_API_KEY,
    site: process.env.DATADOG_SITE,
  }),
  // --- AUTOTEL:SUBSCRIBERS_CONFIG ---
  subscribers: [],
});

// --- AUTOTEL:PLUGIN_INIT ---
```

Do not remove these markers if you want `autotel add` to continue working on the file.

## Common Mistakes

### HIGH: Forgetting `--import` when starting the app

```bash
# Wrong: instrumentation never runs
node dist/index.js

# Correct: register instrumentation before app code loads
node --import ./src/instrumentation.mts dist/index.js
```

The instrumentation file must be loaded before any other module. The `--import` flag is the correct mechanism. `require` or a top-level import inside app code is too late.

### HIGH: Running `autotel add` before `autotel init`

```bash
# Wrong: no instrumentation file exists yet
npx autotel-cli add plugin mongoose

# Correct: create the file first
npx autotel-cli init
npx autotel-cli add plugin mongoose
```

`add` reads and modifies the existing instrumentation file. It will fail if the file does not exist or is not CLI-owned (use `--force` for user-created files).

### MEDIUM: Globbing without quotes

```bash
# Wrong: shell expands the glob before the CLI sees it
npx autotel-cli codemod trace src/**/*.ts

# Correct: quote the glob so the CLI handles expansion
npx autotel-cli codemod trace "src/**/*.ts"
```

### MEDIUM: Using `--force` on init without understanding the backup

`--force` on `init` overwrites an existing instrumentation file but creates a `.bak` backup first. The backup path is logged at `--verbose` level. If you ran `--force` accidentally, check for `instrumentation.mts.bak` in the same directory.

### MEDIUM: Using `--dry-run` and expecting installs to have run

`--dry-run` implies `--no-install` and `--print-install-cmd`. No files are written and no packages are installed. It is purely a preview mode.

## Version

Targets autotel-cli v0.21.1. Node.js >= 22.0.0 required.
