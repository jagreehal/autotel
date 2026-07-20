# autotel-telemetry

Opt-in CLI usage telemetry for Autotel-powered tools.

## Quick start

```ts
import { withCommanderTelemetry } from 'autotel-telemetry';

withCommanderTelemetry(program, { name: 'autotel', version: '1.0.0' });
await program.parseAsync(process.argv);
```

## Opt out

- `DO_NOT_TRACK=1`
- `AUTOTEL_TELEMETRY=0`
- Persisted disable via `autotel telemetry disable`
