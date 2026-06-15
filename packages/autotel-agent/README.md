# autotel-agent

Agent identity, delegation, and audit helpers for `autotel`.

`autotel-agent` gives agentic workflows a stable, privacy-conscious audit surface for recording who acted, under whose authority, which tool ran, and which policy decision allowed or denied the action.

It helps you capture agent behaviour without attaching raw prompts, tool payloads, sensitive evidence, or private reasoning traces directly to telemetry.

This package provides:

- `withAgentAction(...)` to wrap an agent step with normalized `agent.*`, `delegation.*`, `tool.*`, and `policy.*` attributes.
- `withAgentSession(...)` to track session lifecycle transitions such as `active`, `completed`, and `failed`.
- `withAgentToolCall(...)` to wrap tool execution and hash tool inputs/results instead of logging raw payloads.
- `withScopedTool(...)` to enforce delegated scopes, record allow/deny policy decisions, and only then execute the tool.
- `defineAgentAction(...)` / `defineAgentToolCall(...)` to declare a reusable instrumented step once (the `trace()`-style factory companions to `withAgentAction` / `withAgentToolCall`) and call it many times.
- `recordPolicyDecision(...)` to record guardrail and authorization decisions with force-keep semantics.
- `recordDecisionBasis(...)` to record a bounded decision summary without storing raw reasoning traces.
- `delegateToAgent(...)` to derive delegation lineage, depth, and a stable lineage hash for nested agent handoffs.
- `recordAgentHandoff(...)` to emit a canonical handoff record from one agent to another.
- `createAgentIdentityRegistry(...)` to track non-human identity lifecycle, rotation, revocation, and delegated scopes.
- `sanitizeAuditPayload(...)` to apply opinionated privacy profiles for strict, PCI-style, and healthcare-style audit trails.
- `createSignedEventEnvelope(...)` to create tamper-evident, hash-chained audit envelopes for cold storage or SIEM export.
- `createAgentAuditMetadata(...)` to apply a stricter schema with defaults and validation.
- `hashPayload(...)` to produce deterministic SHA-256 hashes for tool inputs, large payloads, or external context blobs.

> **Scope:** this package improves governance and auditability. It does not, on its own, make a system compliant with any standard or regulation. You remain responsible for what you record and how you retain it.

## Why this package exists

A trace shows what ran. An agent audit also has to record:

- Which agent acted
- Under whose authority
- Which tool it invoked
- Which policy decision allowed or denied it
- A hash of sensitive inputs instead of the raw values

`autotel-agent` puts those concerns in one small layer on top of `autotel` and `autotel-audit`.

## Install

```bash
pnpm add autotel-agent autotel autotel-audit
```

## Quick Start

```ts
import { trace } from 'autotel';
import { withAgentAction, withAgentToolCall, recordPolicyDecision } from 'autotel-agent';

export const handleRefund = trace('agent.refund', (ctx) => async (request: {
  userId: string;
  refundId: string;
}) => {
  return withAgentAction(
    {
      action: 'agent.refund.handle',
      resource: 'refund',
      agent: {
        id: 'refunds-specialist',
        version: '2026-06-13',
        framework: 'openai-agents',
        role: 'specialist',
      },
      delegation: {
        parentIdentity: request.userId,
        scope: ['refund:write'],
      },
    },
    async () => {
      recordPolicyDecision({
        action: 'agent.refund.guardrail',
        resource: 'refund',
        agent: { id: 'refunds-specialist' },
        policy: {
          decision: 'permit',
          policyId: 'refund-guardrail-v1',
          riskScore: 0.08,
        },
      });

      return withAgentToolCall(
        {
          action: 'agent.refund.tool_call',
          resource: 'stripe_refund_v3',
          agent: { id: 'refunds-specialist' },
          tool: {
            name: 'stripe_refund_v3',
            input: { refundId: request.refundId },
          },
        },
        async () => {
          return { status: 'complete' };
        },
      );
    },
  );
});
```

The resulting telemetry includes:

- `audit.action=agent.refund.handle`
- `agent.id=refunds-specialist`
- `delegation.parent_identity=<user id>`
- `delegation.scope=["refund:write"]`
- `policy.decision=permit`
- `policy.id=refund-guardrail-v1`
- `tool.name=stripe_refund_v3`
- `tool.input_hash=sha256:...`

Raw tool payloads are not attached as attributes.

> **Use stable identifiers for `parentIdentity`.** It is recorded verbatim as `delegation.parent_identity`. Pass a stable internal identifier (an account or principal ID), not an email, name, session token, or raw customer identifier. If you only have a sensitive identifier, hash it first with `hashPayload(...)` and record the digest.

## Reusable wrappers (`trace`-style)

`withAgentAction` and `withAgentToolCall` run immediately inside the current scope. When you want to **declare an instrumented step once and call it many times** — the same ergonomics as `trace()` — use `defineAgentAction` and `defineAgentToolCall`. They return a normal function; each call opens its own audit scope.

Pass the metadata as a **function of the call arguments** when a field depends on the call (for example `tool.input`, which is hashed per invocation):

```ts
import { defineAgentToolCall } from 'autotel-agent';

const handleRefund = defineAgentToolCall(
  (req: { refundId: string }) => ({
    action: 'agent.refund.tool_call',
    resource: 'stripe_refund_v3',
    agent: { id: 'refunds-specialist' },
    tool: { name: 'stripe_refund_v3', input: { refundId: req.refundId } },
  }),
  (ctx) => async (req: { refundId: string }) => {
    return stripe.refunds.create(req);
  },
);

// Call it like any function — each call hashes its own input and records outcome.
await handleRefund({ refundId: 're_123' });
```

Static metadata works too when nothing depends on the arguments:

```ts
import { defineAgentAction } from 'autotel-agent';

const planTrip = defineAgentAction(
  { action: 'agent.trip.plan', agent: { id: 'planner' } },
  (ctx) => async (destination: string) => {
    ctx.setAttribute('trip.destination', destination);
    return planItinerary(destination);
  },
);

await planTrip('Lisbon');
```

The factory `(ctx) => (...args) => result` mirrors `trace()`: `ctx` is the audit context (use `ctx.setAttribute(...)` for extra fields), and the returned handler receives your call arguments. `logger` is available as a second factory parameter if you need it: `(ctx, logger) => ...`.

| Style | Use when |
| --- | --- |
| `withAgentAction` / `withAgentToolCall` | One-shot, inline inside a handler |
| `defineAgentAction` / `defineAgentToolCall` | Declared once at module scope, called repeatedly |

## LLM cost & token usage

When an agent step *is* an LLM call, attach `ai` metadata. autotel-agent then
records the OpenTelemetry GenAI semantic attributes on the span — reusing the
cost model in the main `autotel` package, so you don't reinvent token/cost
tracking:

- `gen_ai.request.model`, `gen_ai.operation.name`
- `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.total_tokens`
- `gen_ai.usage.cost.usd` (estimated via `estimateLLMCost` / `MODEL_PRICING`)

Token usage is usually known only after the call, so pass `options.extractUsage`
to pull it from the handler's result:

```ts
import { withAgentToolCall } from 'autotel-agent';

const chat = await withAgentToolCall(
  {
    action: 'agent.research.chat',
    agent: { id: 'researcher' },
    tool: { name: 'openai.chat' },
    ai: { model: 'gpt-4o', operation: 'chat' },
  },
  async () => openai.chat.completions.create({ model: 'gpt-4o', messages }),
  {
    extractUsage: (res) => ({
      inputTokens: (res as ChatCompletion).usage?.prompt_tokens,
      outputTokens: (res as ChatCompletion).usage?.completion_tokens,
    }),
  },
);
// span now carries gen_ai.request.model, gen_ai.usage.*_tokens, gen_ai.usage.cost.usd
```

If you know usage up front (or override pricing), set it on the metadata
directly: `ai: { model, usage: { inputTokens, outputTokens }, pricing }`.

## Works in any OpenTelemetry setup

The audit context resolves from the **active OpenTelemetry span** — so the
wrappers attach attributes whether you're inside autotel's `trace()`,
`@effect/opentelemetry`, a vanilla NodeSDK, or an `autotel-cloudflare`
instrumented handler. When no span is active, instrumentation degrades per
`options.onMissingContext` (`'warn'` by default, `'throw'`, or `'skip'`) and
never crashes the wrapped work.

## Canonical Schema

`autotel-agent` normalizes a stricter schema for governance and traceability work:

- `agent.audit.version`
- `agent.event.kind`
- `agent.id`, `agent.version`, `agent.framework`, `agent.model`, `agent.role`
- `delegation.parent_identity`, `delegation.scope`, `delegation.id`
- `delegation.authority_lineage`, `delegation.authority_lineage_hash`, `delegation.depth`
- `policy.decision`, `policy.id`, `policy.risk_score`
- `governance.review_required`, `governance.control_id`, `governance.lifecycle_stage`

Together, these let you reconstruct who was authorized and why each action was allowed or denied.

Additional fields:

- `agent.session.status`, `agent.session.started_at`, `agent.session.ended_at`
- `decision.summary`, `decision.input_hash`, `decision.policy_ids`, `decision.justification_codes`
- `governance.framework`

## Scoped Tool Example

```ts
import {
  createAgentIdentityRegistry,
  withScopedTool,
} from 'autotel-agent';

const identities = createAgentIdentityRegistry([
  {
    agent: { id: 'refund-specialist', role: 'specialist' },
    scopes: ['refund:write'],
    tokenId: 'jti_55102',
  },
]);

await withScopedTool(
  {
    action: 'agent.refund.execute',
    agent: { id: 'refund-specialist' },
    tool: { name: 'stripe_refund_v3' },
    requiredScopes: ['refund:write'],
    policyId: 'refund-scope-v2',
    identityRegistry: identities,
    delegation: {
      parentIdentity: 'usr_99824',
      scope: ['refund:write'],
    },
    decision: {
      summary: 'Refund request is in-policy and below auto-review threshold.',
      policyIds: ['refund-scope-v2'],
      justificationCodes: ['VALID_SCOPE', 'LOW_RISK'],
    },
  },
  { refundId: 're_123' },
  async () => ({ status: 'complete' }),
);
```

## Delegation Example

```ts
import { delegateToAgent, recordAgentHandoff } from 'autotel-agent';

const delegation = delegateToAgent({
  parentIdentity: 'user_123',
  targetAgentId: 'refund-specialist',
  scope: ['refund:write'],
  authorityLineage: ['user_123', 'router'],
});

recordAgentHandoff({
  action: 'agent.handoff',
  fromAgent: { id: 'router' },
  toAgent: { id: 'refund-specialist' },
  parentIdentity: 'user_123',
  scope: ['refund:write'],
  authorityLineage: delegation.authorityLineage,
  governance: {
    reviewRequired: true,
    controlId: ['govern-2.1', 'map-3.5'],
    lifecycleStage: 'operate',
  },
});
```

## Tamper-Evident Export

```ts
import { createSignedEventEnvelope } from 'autotel-agent';

const envelope = await createSignedEventEnvelope(
  {
    action: 'agent.tool_call',
    agent: { id: 'analytics-bot' },
    tool: { name: 'query_warehouse', input: { accountId: 'acct_123' } },
  },
  {
    previousEventHash: 'sha256:previous-event',
    evidence: {
      externalCaseId: 'case_123',
      recordType: 'support_case',
      riskCategory: 'sensitive_personal_data',
    },
    privacyProfile: 'healthcare',
    signer: async (serialized) => signWithKms(serialized),
  },
);
```

The exported envelope includes:

- deterministic `eventHash`
- optional `previousEventHash` for chain integrity
- optional `signature`
- privacy-shaped `evidence` payloads

`evidence` is sanitized according to the selected privacy profile before export. Even so, do not pass raw secrets, credentials, access tokens, or unnecessary personal data into audit events. Record references (a case ID, a record type, a risk category) rather than the sensitive values themselves.
