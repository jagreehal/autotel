---
name: autotel-telemetry
description: >
  Use this skill when adding opt-in CLI usage telemetry to an Autotel-powered command-line tool — withCommanderTelemetry() to instrument a Commander program, and the DO_NOT_TRACK / AUTOTEL_TELEMETRY opt-out contract.
---

# autotel-telemetry

Opt-in usage telemetry for CLI tools built on Autotel. Wrap a Commander program and it records which commands run, so you can see how your tool is used. It respects the standard opt-out signals.

This is telemetry **for your own CLI's usage**, not application observability. For tracing a service, use `autotel`.

## When to use

- Measure which commands and flags a CLI's users actually reach for.
- Ship that measurement with a clear, standard opt-out.

## Core pattern

```ts
import { withCommanderTelemetry } from 'autotel-telemetry';

withCommanderTelemetry(program, { name: 'autotel', version: '1.0.0' });
await program.parseAsync(process.argv);
```

## Opt-out

Honor all three:

- `DO_NOT_TRACK=1` — the cross-tool standard.
- `AUTOTEL_TELEMETRY=0` — package-specific.
- `autotel telemetry disable` — persisted, per-user.

## Common mistakes

### HIGH: Enabling telemetry without surfacing the opt-out

Print a one-line notice on first run pointing at `DO_NOT_TRACK` and `autotel telemetry disable`. Silent collection breaks the "opt-in" contract this package is built around.

### MEDIUM: Sending payloads instead of command shape

This records CLI usage (command, version), not user data. Keep arguments and file contents out of what you send.

## Version

Exports `.` and `./ingest`. Designed for Commander-based CLIs.
