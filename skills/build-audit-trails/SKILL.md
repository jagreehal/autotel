---
name: build-audit-trails
description: >
  Design tamper-aware audit trails on top of OpenTelemetry spans using
  autotel. Covers what counts as auditable, the audit-only span discipline,
  signing and tamper-detection, denial logging, redaction, retention,
  separation of concerns from operational telemetry, and framework wiring
  (Next.js, Nuxt, Hono, Express, Cloudflare Workers).
type: build
library: autotel
license: MIT
---

# Build audit trails

An *audit trail* is a record of who did what to which resource, when, and whether it was permitted — durable, tamper-evident, and admissible. Operational telemetry (latency, errors, span shapes) is for engineers; audit trails are for compliance, security, and forensics. They overlap technically but differ on every other axis.

autotel lets you express both with the same primitive — a span — but you should keep them on **separate processors** so an audit event never gets dropped by sampling, never gets redacted by a debug rule, and never goes to the same backend as your ops data.

## When to use

- Implementing GDPR / HIPAA / SOC2 / PCI-DSS / ISO 27001 / GxP compliance
- Adding "who did what" trails for admin actions, access reviews, payments
- Recording authorization decisions (allow + deny)
- Building immutable evidence for incident response

## The audit span discipline

An auditable event has six required parts:

| Field | OTel attribute | Example |
| --- | --- | --- |
| When | (span timestamp) | `2026-05-04T17:23:11.412Z` |
| Who | `enduser.id` + `enduser.role` | `usr_42`, `admin` |
| Where (acting from) | `client.address`, `network.peer.address`, `user_agent.original` | `203.0.113.5`, `Chrome 121` |
| What | `audit.action` | `secret.read`, `policy.update`, `user.delete` |
| Which resource | `audit.resource.type` + `audit.resource.id` | `secret`, `sec_abc` |
| Outcome | `audit.outcome` (`allow` / `deny`) + `audit.reason` | `deny`, `MFA required` |

Plus useful optional fields: `audit.policy.id` (which policy made the call), `audit.evidence` (linked artefact id), `audit.actor.session.id`.

## Step 1: Define a typed `audit()` helper

Centralise the schema in one place so every site gets it right:

```typescript
import { trace, SpanKind } from '@opentelemetry/api'

type AuditAction =
  | 'secret.read' | 'secret.write' | 'secret.delete'
  | 'policy.update' | 'user.create' | 'user.delete'
  | 'data.export' | 'session.assume'

interface AuditPayload {
  action: AuditAction
  resource: { type: string; id: string }
  outcome: 'allow' | 'deny'
  reason?: string
  actor?: { id: string; role?: string; sessionId?: string }
  policy?: { id: string }
  evidence?: { id: string }
}

const tracer = trace.getTracer('autotel-audit', '1.0.0')

export function audit(payload: AuditPayload): void {
  const span = tracer.startSpan(`audit.${payload.action}`, {
    kind: SpanKind.INTERNAL,
    attributes: {
      'audit': true,
      'audit.action': payload.action,
      'audit.outcome': payload.outcome,
      'audit.resource.type': payload.resource.type,
      'audit.resource.id': payload.resource.id,
      ...(payload.reason && { 'audit.reason': payload.reason }),
      ...(payload.actor?.id && { 'enduser.id': payload.actor.id }),
      ...(payload.actor?.role && { 'enduser.role': payload.actor.role }),
      ...(payload.actor?.sessionId && { 'audit.actor.session.id': payload.actor.sessionId }),
      ...(payload.policy?.id && { 'audit.policy.id': payload.policy.id }),
      ...(payload.evidence?.id && { 'audit.evidence.id': payload.evidence.id }),
    },
  })
  span.end()
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
  const decision = await decide()
  if (!decision.allow) {
    audit({ ...payload, outcome: 'deny', reason: decision.reason })
    throw createStructuredError({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Not allowed',
      why: decision.reason ?? 'Insufficient permissions',
    })
  }
  audit({ ...payload, outcome: 'allow' })
  return body()
}
```

## Step 3: Separate the audit pipeline

Critical: route audit spans to a **different processor and backend** so:

- They are never dropped by head or tail sampling.
- They are not subject to development-mode debug exporters.
- They go to a write-once / append-only store (S3 Object Lock, immutable bucket, dedicated audit DB).

```typescript
import {
  composeSpanProcessors,
  composeSubscribers,
  defineConfig,
} from 'autotel-edge'
import { BatchSpanProcessor, FilteringSpanProcessor } from 'autotel/processors'

const auditExporter = new BatchSpanProcessor(
  new OTLPHttpJsonExporter({ url: process.env.AUDIT_OTLP!, headers: { authorization: `Bearer ${process.env.AUDIT_TOKEN!}` } }),
)
const opsExporter = new BatchSpanProcessor(
  new OTLPHttpJsonExporter({ url: process.env.OPS_OTLP! }),
)

// Only audit spans reach the audit pipeline.
const auditOnly = new FilteringSpanProcessor({
  include: (span) => span.attributes['audit'] === true,
  next: auditExporter,
})

// Conversely, ops never sees audit spans (avoid leaking PII to dashboards).
const opsOnly = new FilteringSpanProcessor({
  exclude: (span) => span.attributes['audit'] === true,
  next: opsExporter,
})

export const otelConfig = defineConfig({
  service: { name: 'app' },
  spanProcessors: composeSpanProcessors([auditOnly, opsOnly]),
})
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

| Field | In audit span? | Notes |
| --- | --- | --- |
| `enduser.id` | ✅ | Internal user id; never the email |
| `audit.resource.id` | ✅ | Required for forensics |
| `client.address` | ✅ | Last-octet redaction acceptable for IPv4 |
| Free-form payload bodies | ❌ | Never inline raw input — link by id (`audit.evidence.id`) |
| Secret values | ❌ | Use `audit.action=secret.read` + `audit.resource.id=sec_abc`, never the secret itself |
| Authorization headers | ❌ | Token names ok (`bearer.*`), values never |

`attributeRedactor` defaults are too aggressive for audit (you may need `enduser.id` literal, not masked). Disable redaction selectively:

```typescript
spanProcessors: composeSpanProcessors([
  // No redactor on the audit branch — keys are already conservative
  auditOnly,
  // Strict redactor on ops
  new AttributeRedactingProcessor(opsOnly, { redactor: 'strict' }),
])
```

## Step 6: Retention

Audit retention is set by regulation, not engineering taste. Common minimums:

| Regulation | Minimum retention |
| --- | --- |
| GDPR | 6 years (financial), 12 months (operational) |
| HIPAA | 6 years |
| PCI-DSS | 1 year (online), 3 months hot |
| SOX | 7 years |
| GxP / 21 CFR Part 11 | Lifetime of product + 10 years |

Express retention as a backend lifecycle policy (S3 Object Lock COMPLIANCE mode, BigQuery `--time_partitioning_expiration`), not application code.

## Step 7: Framework wiring

### Next.js

```typescript
// app/admin/users/[id]/route.ts
import { withAuthz, audit } from '@/lib/audit'

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  return withAuthz(
    {
      action: 'user.delete',
      resource: { type: 'user', id: params.id },
      actor: { id: req.headers.get('x-user-id')!, role: 'admin' },
    },
    async () => ({ allow: await canDelete(req, params.id) }),
    async () => {
      await db.user.delete({ where: { id: params.id } })
      return Response.json({ ok: true })
    },
  )
}
```

### Hono

```typescript
import { audit, withAuthz } from './audit'
app.post('/secrets/:id/read', async (c) => {
  return withAuthz(
    {
      action: 'secret.read',
      resource: { type: 'secret', id: c.req.param('id') },
      actor: { id: c.var.user.id, role: c.var.user.role },
    },
    () => requireScope(c, 'secrets:read'),
    async () => c.json({ value: await secrets.read(c.req.param('id')) }),
  )
})
```

### Cloudflare Workers

`audit()` from inside `defineWorkerFetch` — `ctx.waitUntil` makes sure the audit span is exported before the response returns:

```typescript
export default defineWorkerFetch(
  { service: { name: 'admin-api' } },
  async (request, env, ctx, log) => {
    return withAuthz(
      { action: 'data.export', resource: { type: 'project', id: 'p_123' }, actor: { id: 'usr_42' } },
      async () => ({ allow: true }),
      async () => Response.json({ ok: true }),
    )
  },
)
```

## Anti-patterns

| Anti-pattern | Fix |
| --- | --- |
| Audit logs in `console.log` / unstructured | Use `audit()` so every event has the same shape |
| Same backend for audit and ops | Separate processors, separate retention |
| Audit subject to sampling | `FilteringSpanProcessor` with `include: span.attributes.audit` |
| Logging only successes | Always log denials too |
| Putting secrets / payloads in audit attributes | Reference by id only (`audit.evidence.id`) |
| No tamper detection | HMAC signature on critical environments |
| Custom retention in code | Express via storage-layer lifecycle policy |
| Audit on every read of harmless data | Audit *meaningful* events; not every list call |
| Audit row tied to a specific framework | The `audit()` function is framework-agnostic |
| `enduser.id` = email | Use the internal id; emails go in a separate identity table |
