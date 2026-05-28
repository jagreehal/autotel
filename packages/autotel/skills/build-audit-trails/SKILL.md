---
name: build-audit-trails
description: >
  Build or review tamper-aware audit trails on top of OpenTelemetry spans
  using autotel and the autotel-audit package (`withAudit`,
  `setAuditAttributes`, `forceKeepAuditEvent`). Covers what counts as
  auditable, the audit-only span discipline, sampling bypass, HMAC and
  hash-chain signing with tamper detection, denial logging, redaction,
  retention, GDPR right-to-erasure via crypto-shredding, separation from
  operational telemetry, testing audit spans, backend-agnostic audit queries,
  a production-readiness checklist, and framework wiring (Next.js, Nuxt,
  Nitro, NestJS, Express, Fastify, Hono, Cloudflare Workers, AWS Lambda,
  standalone). Use it to design new audit trails or review existing ones for
  GDPR, HIPAA, SOC 2, PCI-DSS, ISO 27001, SOX, and GxP compliance.
license: MIT
---

# Build audit trails

An _audit trail_ is a record of who did what to which resource, when, and whether it was permitted — durable, tamper-evident, and admissible. Operational telemetry (latency, errors, span shapes) is for engineers; audit trails are for compliance, security, and forensics. They overlap technically but differ on every other axis.

autotel lets you express both with the same primitive — a span — but you should keep them on **separate processors** so an audit event never gets dropped by sampling, never gets redacted by a debug rule, and never goes to the same backend as your ops data.

## When to use

- Implementing GDPR / HIPAA / SOC2 / PCI-DSS / ISO 27001 / GxP compliance
- Adding "who did what" trails for admin actions, access reviews, payments
- Recording authorization decisions (allow + deny)
- Building immutable evidence for incident response
- Reviewing an existing audit trail for compliance gaps (see "Review an existing audit trail")

## Quick reference

| Situation                                           | Use                                                      |
| --------------------------------------------------- | -------------------------------------------------------- |
| Wrap an action so success/failure is audited + kept | `withAudit(metadata, fn)` from `autotel-audit`           |
| Tag the active span with `audit.*` attributes only  | `setAuditAttributes(metadata)`                           |
| Make sure an audit span survives tail sampling      | `forceKeepAuditEvent()`                                  |
| Record an authorization denial                      | `audit({ …, outcome: 'deny', reason })` (Step 1 helper)  |
| Full control / framework-agnostic span helper       | hand-rolled `audit()` (Step 1)                           |
| Keep audit data off ops dashboards                  | `FilteringSpanProcessor` split (Step 3)                  |
| Prove a record was not altered                      | HMAC or hash-chain signature (Step 4)                    |
| Honor a GDPR erasure request on an append-only log  | crypto-shredding (Step 6.5)                              |
| Assert the trail in tests                           | `createTraceCollector()` from `autotel/testing` (Step 8) |

## The shortest path: the `autotel-audit` package

`autotel-audit` ships this discipline as helpers. Reach for these before hand-rolling:

```typescript
import {
  withAudit,
  setAuditAttributes,
  forceKeepAuditEvent,
} from 'autotel-audit';

// Wrap the action: sets audit.* attributes, force-keeps past tail sampling,
// and tags outcome 'success' / 'failure' automatically.
await withAudit(
  {
    action: 'user.delete',
    resource: 'user',
    actorId: 'usr_42',
    category: 'admin',
  },
  async () => db.user.delete({ where: { id } }),
);

// Or tag the current span yourself and opt out of sampling:
setAuditAttributes({
  action: 'secret.read',
  resource: 'sec_abc',
  actorId: 'usr_42',
});
forceKeepAuditEvent();
```

`withAudit` marks the span with `autotel.audit = true` and sets the tail-sampling keep flags via `forceKeepAuditEvent`, so audit events are never dropped. The rest of this guide builds the same model from raw spans when you need full control over the schema, signing, and the pipeline split. If you use the package, filter on `autotel.audit` (not `audit`) in Step 3.

## The audit span discipline

An auditable event has six required parts:

| Field               | OTel attribute                                                  | Example                                       |
| ------------------- | --------------------------------------------------------------- | --------------------------------------------- |
| When                | (span timestamp)                                                | `2026-05-04T17:23:11.412Z`                    |
| Who                 | `enduser.id` + `enduser.role`                                   | `usr_42`, `admin`                             |
| Where (acting from) | `client.address`, `network.peer.address`, `user_agent.original` | `203.0.113.5`, `Chrome 121`                   |
| What                | `audit.action`                                                  | `secret.read`, `policy.update`, `user.delete` |
| Which resource      | `audit.resource.type` + `audit.resource.id`                     | `secret`, `sec_abc`                           |
| Outcome             | `audit.outcome` (`allow` / `deny`) + `audit.reason`             | `deny`, `MFA required`                        |

Plus useful optional fields: `audit.policy.id` (which policy made the call), `audit.evidence` (linked artefact id), `audit.actor.session.id`.

## Step 1: Define a typed `audit()` helper

Centralise the schema in one place so every site gets it right:

```typescript
import { trace, SpanKind } from '@opentelemetry/api';

type AuditAction =
  | 'secret.read'
  | 'secret.write'
  | 'secret.delete'
  | 'policy.update'
  | 'user.create'
  | 'user.delete'
  | 'data.export'
  | 'session.assume';

interface AuditPayload {
  action: AuditAction;
  resource: { type: string; id: string };
  outcome: 'allow' | 'deny';
  reason?: string;
  actor?: { id: string; role?: string; sessionId?: string };
  policy?: { id: string };
  evidence?: { id: string };
}

const tracer = trace.getTracer('autotel-audit', '1.0.0');

export function audit(payload: AuditPayload): void {
  const span = tracer.startSpan(`audit.${payload.action}`, {
    kind: SpanKind.INTERNAL,
    attributes: {
      audit: true,
      'audit.action': payload.action,
      'audit.outcome': payload.outcome,
      'audit.resource.type': payload.resource.type,
      'audit.resource.id': payload.resource.id,
      ...(payload.reason && { 'audit.reason': payload.reason }),
      ...(payload.actor?.id && { 'enduser.id': payload.actor.id }),
      ...(payload.actor?.role && { 'enduser.role': payload.actor.role }),
      ...(payload.actor?.sessionId && {
        'audit.actor.session.id': payload.actor.sessionId,
      }),
      ...(payload.policy?.id && { 'audit.policy.id': payload.policy.id }),
      ...(payload.evidence?.id && { 'audit.evidence.id': payload.evidence.id }),
    },
  });
  span.end();
}
```

## Step 2: Always log denials

A frequent compliance failure is "we logged what users did but not what we **stopped** them doing." Wrap the authorization decision so both branches go through `audit()`:

```typescript
export async function withAuthz<T>(
  payload: Omit<AuditPayload, 'outcome'>,
  decide: () => Promise<{ allow: boolean; reason?: string }>,
  body: () => Promise<T>,
): Promise<T> {
  const decision = await decide();
  if (!decision.allow) {
    audit({ ...payload, outcome: 'deny', reason: decision.reason });
    throw createStructuredError({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Not allowed',
      why: decision.reason ?? 'Insufficient permissions',
    });
  }
  audit({ ...payload, outcome: 'allow' });
  return body();
}
```

## Step 3: Separate the audit pipeline

Critical: route audit spans to a **different processor and backend** so:

- They are never dropped by head or tail sampling.
- They are not subject to development-mode debug exporters.
- They go to a write-once / append-only store (S3 Object Lock, immutable bucket, dedicated audit DB).

How a span flows once you split the pipeline:

```text
audit(payload)
  └─ span.attributes['audit'] = true   (or autotel.audit via the package)
       │
       ├─► FilteringSpanProcessor include: audit === true  ─► auditExporter ─► append-only store
       │
       └─► FilteringSpanProcessor exclude: audit === true  ─► opsExporter  (PII-redacted dashboards)
```

```typescript
import {
  composeSpanProcessors,
  composeSubscribers,
  defineConfig,
} from 'autotel-edge';
import { BatchSpanProcessor, FilteringSpanProcessor } from 'autotel/processors';

const auditExporter = new BatchSpanProcessor(
  new OTLPHttpJsonExporter({
    url: process.env.AUDIT_OTLP!,
    headers: { authorization: `Bearer ${process.env.AUDIT_TOKEN!}` },
  }),
);
const opsExporter = new BatchSpanProcessor(
  new OTLPHttpJsonExporter({ url: process.env.OPS_OTLP! }),
);

// Only audit spans reach the audit pipeline.
const auditOnly = new FilteringSpanProcessor({
  include: (span) => span.attributes['audit'] === true,
  next: auditExporter,
});

// Conversely, ops never sees audit spans (avoid leaking PII to dashboards).
const opsOnly = new FilteringSpanProcessor({
  exclude: (span) => span.attributes['audit'] === true,
  next: opsExporter,
});

export const otelConfig = defineConfig({
  service: { name: 'app' },
  spanProcessors: composeSpanProcessors([auditOnly, opsOnly]),
});
```

## Step 4: Tamper detection

For environments where audit storage is shared with the producing service (no append-only bucket), sign each span:

```typescript
import { createHmac, randomUUID } from 'node:crypto'

function signAuditAttributes(attrs: Record<string, unknown>): string {
  const key = process.env.AUDIT_HMAC_KEY!
  const payload = JSON.stringify(Object.fromEntries(Object.entries(attrs).sort()))
  return createHmac('sha256', key).update(payload).digest('hex')
}

export function audit(payload: AuditPayload): void {
  const id = randomUUID()
  const attributes = { /* … as before … */, 'audit.id': id }
  const signature = signAuditAttributes(attributes)
  attributes['audit.signature.alg'] = 'HMAC-SHA256'
  attributes['audit.signature.value'] = signature
  // … startSpan …
}
```

Verify on the read side: recompute the HMAC over the same sorted attribute set (excluding `audit.signature.value` itself); mismatched ⇒ tampered.

For multi-tenant or extra-strict (HIPAA), use Ed25519 with per-environment keys and rotate.

## Step 5: Redaction — what stays and what goes

| Field                    | In audit span? | Notes                                                                                 |
| ------------------------ | -------------- | ------------------------------------------------------------------------------------- |
| `enduser.id`             | ✅             | Internal user id; never the email                                                     |
| `audit.resource.id`      | ✅             | Required for forensics                                                                |
| `client.address`         | ✅             | Last-octet redaction acceptable for IPv4                                              |
| Free-form payload bodies | ❌             | Never inline raw input — link by id (`audit.evidence.id`)                             |
| Secret values            | ❌             | Use `audit.action=secret.read` + `audit.resource.id=sec_abc`, never the secret itself |
| Authorization headers    | ❌             | Token names ok (`bearer.*`), values never                                             |

`attributeRedactor` defaults are too aggressive for audit (you may need `enduser.id` literal, not masked). Disable redaction selectively:

```typescript
spanProcessors: composeSpanProcessors([
  // No redactor on the audit branch — keys are already conservative
  auditOnly,
  // Strict redactor on ops
  new AttributeRedactingProcessor(opsOnly, { redactor: 'strict' }),
]);
```

## Step 6: Retention

Audit retention is set by regulation, not engineering taste. Common minimums:

| Regulation           | Minimum retention                            |
| -------------------- | -------------------------------------------- |
| GDPR                 | 6 years (financial), 12 months (operational) |
| HIPAA                | 6 years                                      |
| PCI-DSS              | 1 year (online), 3 months hot                |
| SOX                  | 7 years                                      |
| GxP / 21 CFR Part 11 | Lifetime of product + 10 years               |

Express retention as a backend lifecycle policy (S3 Object Lock COMPLIANCE mode, BigQuery `--time_partitioning_expiration`), not application code.

## Step 6.5: GDPR and the right to erasure

An append-only audit log and GDPR Article 17 ("right to be forgotten") look like a contradiction: you must keep the audit record, but the subject can demand their personal data be erased. Resolve it with **crypto-shredding** rather than deleting rows.

- Store the immutable facts in the clear: `audit.action`, `audit.outcome`, timestamps, `audit.resource.id`.
- Encrypt any personal data (names, emails, free-form context) with a **per-subject key**, and store only the ciphertext on the span (or a reference to it).
- Keep per-subject keys in a separate key store. To honor an erasure request, delete that subject's key. The audit record stays intact and tamper-evident; the personal fields become permanently unrecoverable.

```typescript
// Never put raw PII on the span. Store a reference and shred the key on request.
setAuditAttributes({
  action: 'profile.update',
  resource: 'user',
  actorId: 'usr_42',
  'subject.id': 'usr_42', // internal id, safe to retain
  'pii.ref': 'kms://subjects/usr_42/v3', // ciphertext lives off-span, keyed per subject
});
```

This keeps the chain of custody and signatures valid (you never mutate a signed record) while making erasure a key-management operation. Confirm the approach with your DPO; some regulators accept crypto-shredding as erasure, others want documented justification.

## Step 7: Framework wiring

The handlers below are the common cases. For Nuxt, Nitro, NestJS, Fastify, AWS Lambda, and standalone jobs, see [references/framework-wiring.md](references/framework-wiring.md).

### Next.js

```typescript
// app/admin/users/[id]/route.ts
import { withAuthz, audit } from '@/lib/audit';

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
) {
  return withAuthz(
    {
      action: 'user.delete',
      resource: { type: 'user', id: params.id },
      actor: { id: req.headers.get('x-user-id')!, role: 'admin' },
    },
    async () => ({ allow: await canDelete(req, params.id) }),
    async () => {
      await db.user.delete({ where: { id: params.id } });
      return Response.json({ ok: true });
    },
  );
}
```

### Hono

```typescript
import { audit, withAuthz } from './audit';
app.post('/secrets/:id/read', async (c) => {
  return withAuthz(
    {
      action: 'secret.read',
      resource: { type: 'secret', id: c.req.param('id') },
      actor: { id: c.var.user.id, role: c.var.user.role },
    },
    () => requireScope(c, 'secrets:read'),
    async () => c.json({ value: await secrets.read(c.req.param('id')) }),
  );
});
```

### Cloudflare Workers

`audit()` from inside `defineWorkerFetch` — `ctx.waitUntil` makes sure the audit span is exported before the response returns:

```typescript
export default defineWorkerFetch(
  { service: { name: 'admin-api' } },
  async (request, env, ctx, log) => {
    return withAuthz(
      {
        action: 'data.export',
        resource: { type: 'project', id: 'p_123' },
        actor: { id: 'usr_42' },
      },
      async () => ({ allow: true }),
      async () => Response.json({ ok: true }),
    );
  },
);
```

## Step 8: Test the trail

An audit trail you have not tested is a compliance risk. The two tests that matter most: the denial path is recorded, and the audit attributes are present and correct. Use `createTraceCollector()` from `autotel/testing` to assert on emitted spans.

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createTraceCollector, type TraceCollector } from 'autotel/testing';

describe('audit trail', () => {
  let collector: TraceCollector;
  beforeEach(() => {
    collector = createTraceCollector();
  });

  it('records a denial with reason and actor', async () => {
    await expect(deleteUser(forbiddenReq)).rejects.toMatchObject({
      status: 403,
    });

    const [span] = collector.getSpansByAttributes({ 'audit.outcome': 'deny' });
    expect(span).toBeDefined();
    expect(span.attributes['audit.action']).toBe('user.delete');
    expect(span.attributes['audit.reason']).toBeTruthy();
    expect(span.attributes['enduser.id']).toBe('usr_42');
  });

  it('records the success path on allow', async () => {
    await deleteUser(allowedReq);
    expect(
      collector.getSpansByAttributes({ 'audit.outcome': 'allow' }),
    ).toHaveLength(1);
  });
});
```

Test the signature too: build an audit span, recompute the HMAC over the sorted attributes, and assert it matches; then mutate one attribute and assert it no longer does.

## Review an existing audit trail

When the task is to audit existing code rather than build new, work these four passes in order and report findings as you go.

1. **Pipeline.** Grep for where audit spans are produced (`audit(`, `withAudit`, `setAuditAttributes`). Confirm a `FilteringSpanProcessor` routes them to a separate, append-only backend, and that ops never receives them. Flag any audit span subject to sampling.
2. **Coverage.** List every `audit(`/`withAudit` call site. Are denials logged, not just successes? Are mutating admin actions, access reviews, payments, and data exports all covered? Flag audit-on-every-read noise.
3. **Integrity + redaction.** Is there a signature (HMAC or hash-chain) where storage is shared with the producer? Are raw payloads, secrets, or emails on the span instead of references and internal ids? Is the ops branch redacted?
4. **Tests + retention.** Is there a denial-path test and a signature-verification test? Is retention enforced at the storage layer (lifecycle policy), not in code?

## Production checklist

- [ ] Audit spans marked (`audit` / `autotel.audit`) and force-kept past sampling
- [ ] Separate processor and backend from ops; ops branch redacted
- [ ] Both allow and deny outcomes recorded
- [ ] No secrets, tokens, raw payloads, or emails on spans (references and internal ids only)
- [ ] Signature (HMAC or hash-chain) where storage is shared with the producer; keys rotated
- [ ] Retention set as a storage lifecycle policy per regulation
- [ ] GDPR erasure plan (crypto-shredding) for personal fields
- [ ] Multi-tenant isolation on the audit store
- [ ] Denial-path and signature-verification tests in CI

To query the trail (denials, per-actor history, tamper detection) across Honeycomb, Grafana Tempo, or Datadog, see [references/audit-queries.md](references/audit-queries.md).

## Anti-patterns

| Anti-pattern                                   | Fix                                                            |
| ---------------------------------------------- | -------------------------------------------------------------- |
| Audit logs in `console.log` / unstructured     | Use `audit()` so every event has the same shape                |
| Same backend for audit and ops                 | Separate processors, separate retention                        |
| Audit subject to sampling                      | `FilteringSpanProcessor` with `include: span.attributes.audit` |
| Logging only successes                         | Always log denials too                                         |
| Putting secrets / payloads in audit attributes | Reference by id only (`audit.evidence.id`)                     |
| No tamper detection                            | HMAC signature on critical environments                        |
| Custom retention in code                       | Express via storage-layer lifecycle policy                     |
| Audit on every read of harmless data           | Audit _meaningful_ events; not every list call                 |
| Audit row tied to a specific framework         | The `audit()` function is framework-agnostic                   |
| `enduser.id` = email                           | Use the internal id; emails go in a separate identity table    |

## Glossary

- **Audit span** — an OpenTelemetry span that records who did what to which resource, marked `audit` / `autotel.audit` so it is routed and retained separately from ops telemetry.
- **Force-keep** — opting a span out of tail sampling so it is always exported; `forceKeepAuditEvent()` sets the autotel tail-keep flags.
- **Denial** — an authorization decision that blocked an action; recorded with `audit.outcome = 'deny'` and a reason. Logging denials is as important as logging successes.
- **Hash-chain** — linking each audit record to the hash of the previous one so removing or reordering records is detectable.
- **Crypto-shredding** — satisfying an erasure request by destroying the per-subject encryption key rather than deleting the immutable record.
- **Append-only store** — a backend that rejects updates and deletes (S3 Object Lock, immutable bucket, WORM storage), the destination for audit spans.
