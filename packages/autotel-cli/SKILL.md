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

- `0` — success
- `1` — runtime / unexpected failure
- `2` — validation / conflict / refusal (caller-fixable)

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
