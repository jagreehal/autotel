---
'autotel': major
---

Process shutdown handlers are now opt-in instead of auto-registered on import.

Importing `autotel` no longer installs `SIGTERM`/`SIGINT` listeners. Long-running
applications opt in via `init()`:

```typescript
init({
  service: 'checkout-api',
  processHandlers: true, // SIGTERM/SIGINT + fatal errors, 2s shutdown timeout
});
```

Or override individual defaults:

```typescript
init({
  service: 'checkout-api',
  processHandlers: {
    signals: ['SIGTERM'], // default: ['SIGTERM', 'SIGINT']
    fatalErrors: false, // default: true (uncaughtException + unhandledRejection)
    shutdownTimeoutMs: 5_000, // default: 2_000
  },
});
```

Enabled signals flush telemetry via `shutdown()` (bounded by `shutdownTimeoutMs`,
default 2s) and exit with the conventional signal status (143 for SIGTERM, 130 for
SIGINT); fatal errors exit with status 1. Applications that manage their own
shutdown should keep their own handlers and call `await shutdown()` explicitly.

Also: `shutdown()` now suppresses unreachable-endpoint exporter errors
(`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`) across `AggregateError` and `cause`
chains, not just a top-level `ECONNREFUSED`.
