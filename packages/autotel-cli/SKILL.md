# autotel-cli skill (agent bootstrap)

This file is a **discovery stub, not the usage guide.** The real, version-aligned usage docs live inside the binary itself.

To learn what `autotel-cli` can do right now:

```bash
# Full command manifest with side-effect metadata
npx autotel schema

# Error envelope shape and stable AUTOTEL_E_* codes
npx autotel schema errors

# JSON output shapes per command
npx autotel schema outputs

# Compact one-line-per-command listing
npx autotel commands

# Copy-pasteable examples
npx autotel examples              # all
npx autotel examples init         # one command

# Version + runtime info
npx autotel version
```

Every command supports `--json`. Errors are returned as a structured envelope
(see `npx autotel schema errors`). Exit codes:

- `0`: success
- `1`: runtime / unexpected failure
- `2`: validation / conflict / refusal (caller-fixable)

## Understanding a codebase's observability

`autotel map` is the read-only command to reach for before suggesting instrumentation:
it finds every entry point, says which are dark, and carries the fix with each finding.

```bash
# Every entry point, its checks, its score, and the fix for each failure
npx autotel map --json --no-write

# One entry point in detail
npx autotel map --json --no-write app/api/checkout/route.ts

# Gate: exit 1 below a score, or when a passing check regresses
npx autotel map --min-score 70 --json
npx autotel map --baseline git:origin/main --json
```

Each failing check in `map.routes[].checks` carries `message`, `evidence`
(`file`, `line`, `snippet`), and `fix` — the code that would make it pass. Read
those instead of guessing what a handler is missing.

## Agent-native init

```bash
# Detection-only preview (no writes)
npx autotel init --detect-only --json

# Preview as JSON without writing
npx autotel init --json --dry-run

# Apply detected plan non-interactively
npx autotel init --yes --json

# Generate a plan, hand it to a human for review, apply later
npx autotel init --detect-only --json --output-file /tmp/plan.json
# ... review /tmp/plan.json ...
npx autotel init --plan /tmp/plan.json --json

# Pipe a plan from stdin
cat plan.json | npx autotel init --input - --json

# Redact secret-shaped values from all JSON output
npx autotel init --json --no-secrets-in-output
# (also via AUTOTEL_NO_SECRETS=1 or AGENT_SANDBOX=1)
```

## Consent for .env files

`.env.example` is read freely (it's committed). Uncommitted `.env` / `.env.local`
are gated. Pass `--scan-env` to consent non-interactively, or accept the
prompt in interactive mode. Only env-var **keys** are read; values are never
sent to stdout.

## What is autotel?

`autotel` is an ergonomic OpenTelemetry instrumentation layer for Node.js and
edge runtimes. `autotel-cli` is the setup wizard. The full project lives at
https://github.com/jagreehal/autotel.
