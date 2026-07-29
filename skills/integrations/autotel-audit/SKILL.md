---
name: autotel-audit
description: >
  Use this skill when writing compliance audit trails or security events that must survive tail-sampling — withAudit() for actor/resource/action logging, forceKeepAuditEvent() to bypass tail-drop, securityEvent()/withSecurity() for OWASP-aligned security.* events, createSecuritySignalProcessor() for zero-code signals from HTTP spans, or hashIdentifier() to correlate PII without logging it.
---

# autotel-audit

Audit and security-event helpers on top of `autotel`. Audit events must reach the backend even when tail-sampling drops the rest of the trace, so every helper here **force-keeps** by default and writes a normalized `audit.*` / `security.*` schema.

## When to use

- Log who did what to which resource, with a `success`/`failure` outcome.
- Guarantee a compliance event survives tail-sampling.
- Emit OWASP A09-aligned security events with a stable schema.
- Derive security signals from HTTP spans you already emit, with no per-route code.
- Correlate a PII-bearing identifier (email, IP) without storing the raw value.

## Core patterns

### Wrap an operation with audit metadata

`withAudit` tags the outcome automatically (`success` unless the function throws) and resolves audit context from the active trace.

```ts
import { trace } from 'autotel';
import { withAudit } from 'autotel-audit';

export const deleteUser = trace(async () => {
  return withAudit(
    { action: 'user.delete', resource: 'user', actorId: 'admin-42' },
    async (_ctx, log) => {
      log.info('User deleted');
      return { ok: true };
    },
    { emitNow: true }, // emit immediately for real-time compliance
  );
});
```

`forceKeep` defaults to `true`, so the event bypasses tail-drop. Pass `emitNow: true` to emit at once rather than at request end.

### Force-keep an existing trace

```ts
import { forceKeepAuditEvent } from 'autotel-audit';

forceKeepAuditEvent(); // marks the active trace so tail-sampling keeps it
```

### Emit a security event

```ts
import { securityEvent, withSecurity } from 'autotel-audit';

securityEvent({ type: 'auth.failure', clientId: hashIdentifier(ip) });
```

Security events force-keep by default, carry a credential-key guard, and bump a counter metric.

### Zero-code security signals from HTTP spans

```ts
import { createSecuritySignalProcessor } from 'autotel-audit';

const processor = createSecuritySignalProcessor();
// register with your TracerProvider
```

It flags suspicious paths, meters denied responses, and detects per-client auth-failure bursts from the HTTP spans already flowing.

### Correlate PII safely

```ts
import { hashIdentifier } from 'autotel-audit';

const key = hashIdentifier('user@example.com'); // stable one-way digest
```

## Common mistakes

### HIGH: Logging raw PII in audit attributes

Audit events are force-kept and persisted for compliance, so raw emails or IPs live indefinitely. Digest them with `hashIdentifier()` and store the hash.

### MEDIUM: Relying on `emitNow: false` for real-time systems

The default emits at request end. A compliance system reading events live needs `emitNow: true`.

## Version

Depends on `autotel` for the request logger and trace context. Security schema aligns with OWASP A09.
