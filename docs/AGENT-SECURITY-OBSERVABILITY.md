# Agent Security Observability

Map Google’s Secure AI Agents principles to Autotel’s OpenTelemetry hooks. Autotel
**observes and characterizes** at decision points; your policy engine still
**enforces** blocks, consent gates, and scope checks.

> **Scope**
>
> - Autotel exports traces, metrics, and structured events. It does not
>   authenticate, authorize, block, or page anyone.
> - Pair deterministic guardrails (`autotel-genai/guard`, scoped tools) with
>   protocol-boundary signals (`autotel-mcp-instrumentation/security`) and unified
>   security events (`autotel-audit`).
> - Alert rules and dashboards live in your OTLP backend.

## Google’s three principles → Autotel packages

| Principle | What to instrument | Primary packages |
|-----------|-------------------|------------------|
| **1. Human controllers** | Controlling user, consent, input provenance | `autotel-genai/agent`, `autotel-cloudflare/agents` |
| **2. Limited powers** | Scopes, policy decisions, action risk class, guard stops | `autotel-genai/agent`, `autotel-genai/guard`, MCP tool hints |
| **3. Observable actions** | Audit trail, MCP boundary, security events, plan/memory/render | All of the above + `autotel-audit`, `autotel-cli` |

## One-time setup

```typescript
import { init } from 'autotel';
import {
  createSecuritySignalProcessor,
  createMcpSecurityEventBridge,
  startSecurityHeartbeat,
} from 'autotel-audit';
import { createGenAiBudget } from 'autotel-genai/guard';
import { heuristicInjectionClassifier } from 'autotel-mcp-instrumentation/security';
import { instrumentMcpClient } from 'autotel-mcp-instrumentation/client';

init({
  service: 'agent-api',
  spanProcessors: [createSecuritySignalProcessor()],
});

startSecurityHeartbeat();

const guard = createGenAiBudget({ maxToolCalls: 50, maxCostUsd: 5 });
const securityBridge = createMcpSecurityEventBridge();

instrumentMcpClient(mcpClient, {
  securityClassifier: heuristicInjectionClassifier(),
  guard,
  outputCharBudget: 1500,
  bridgeSecurityEvents: true,
  securityEventBridge: securityBridge,
});
```

## Principle 1 — Human controllers

| Attribute / API | Purpose |
|-----------------|---------|
| `agent.controller.id` | Hashed controlling human (`recordControllerId`) |
| `agent.consent.required` / `agent.consent.outcome` | Human approval before risky tools (`recordHumanApproval`) |
| `agent.input.provenance` | Trusted vs untrusted input (`recordInputProvenance`) |

Cloudflare Agents SDK `tool:approval` events call `recordHumanApproval()` via
`autotel-cloudflare/agents` OTel observability (requires optional `autotel-genai` peer).

```typescript
import { recordControllerId, recordHumanApproval, recordInputProvenance } from 'autotel-genai/agent';

recordControllerId({ controllerId: userId });
recordInputProvenance({ provenance: 'external_untrusted' });

// After user approves a destructive tool:
recordHumanApproval({ toolCallId, toolName: 'send_email', approved: true, controllerId: userId });
```

## Principle 2 — Limited powers

| Signal | Source |
|--------|--------|
| `policy.decision=deny` + `llm.tool_call.denied` | `withScopedTool` scope checks |
| `llm.guard.triggered` | `autotel-genai/guard` stop rules |
| `agent.scope.active` | Dynamic scopes for this task (`recordActiveScopes`) |
| `agent.action.risk_class` | Derived from MCP hints (`deriveActionRiskClass`) |
| `mcp.tool.read_only` / `destructive` / `untrusted_content` | MCP instrumentation |

```typescript
import { withScopedTool, deriveActionRiskClass, recordActionRiskClass } from 'autotel-genai/agent';

recordActionRiskClass(
  deriveActionRiskClass({ readOnlyHint: false, destructiveHint: true, openWorldHint: true }),
);

await withScopedTool(
  {
    agent,
    action: 'tool.send_email',
    tool: { name: 'send_email' },
    requiredScopes: ['email:send'],
    delegation,
  },
  input,
  () => sendEmail(input),
);
```

## Principle 3 — Observable actions

### Agent audit (hashed I/O, bounded decisions)

- `tool.input_hash` / `tool.output_hash` — never raw payloads
- `decision.summary` — bounded evidence, not chain-of-thought
- `withAgentSession` / `withAgentAction` / `withAudit`

### MCP protocol boundary

See [MCP security observability](../packages/autotel-mcp-instrumentation/README.md#security-observability).

Bridge to unified alerting (optional):

```typescript
instrumentMcpClient(client, {
  bridgeSecurityEvents: true,
  securityEventBridge: createMcpSecurityEventBridge(),
});
```

Maps:

- `mcp.security.injection_suspected` → `llm.prompt_injection.detected`
- Output budget breach → `llm.output.budget_exceeded`
- Manifest classifier verdict ≠ clean → `llm.manifest.suspicious`

### Lifecycle touchpoints (observer)

Feed plan, memory, and render events through `createGenAiObserver`:

```typescript
import { createGenAiObserver } from 'autotel-genai/observer';

const observe = createGenAiObserver();
observe({ type: 'agent.start', id: 'a1', agent: { name: 'planner' } });
observe({
  type: 'plan.step',
  parentId: 'a1',
  stepIndex: 1,
  toolIntents: ['search', 'summarize'],
  summary: 'Retrieve docs then summarize',
});
observe({
  type: 'memory.access',
  parentId: 'a1',
  operation: 'read',
  isolationKey: `user:${userId}`,
  contentHash: 'abc123…',
});
observe({
  type: 'render.output',
  parentId: 'a1',
  format: 'markdown',
  containsUrl: true,
  urlCount: 2,
});
```

### Passive correlation (email-then-exfil pattern)

`createSecuritySignalProcessor()` detects destructive MCP tool calls that follow
`mcp.tool.untrusted_content=true` on the same trace → `llm_action_chain_suspicious`
anomaly metric and `llm.action_chain.suspicious` security event.

### Plan-risk classifiers (Layer 2 pluggability)

Pass a custom `AgentPlanClassifier` or the built-in heuristic:

```typescript
import {
  heuristicPlanRiskClassifier,
  runAgentPlanClassifier,
} from 'autotel-genai/agent';

await runAgentPlanClassifier(
  heuristicPlanRiskClassifier(),
  { toolSequence: ['read_inbox', 'send_email'], stepIndex: 1 },
  { emitSecurityEvent: true },
);
```

Stamps `agent.plan.risk.*` attrs; optional `llm.plan.risk.elevated` security event.

## Security event catalogue (LLM / agent)

| Event | When |
|-------|------|
| `llm.prompt_injection.detected` | MCP classifier verdict ≠ clean (via bridge) |
| `llm.tool_call.denied` | Scoped tool scope/policy deny |
| `llm.guard.triggered` | GenAI guard stop rule fires |
| `llm.output.budget_exceeded` | MCP output char budget exceeded |
| `llm.manifest.suspicious` | MCP manifest classifier verdict ≠ clean (via bridge) |
| `llm.plan.risk.elevated` | Plan-risk classifier verdict ≠ low |
| `llm.action_chain.suspicious` | Untrusted MCP tool then destructive tool (passive) |

## Telemetry contract

The published surface is versioned in
[`packages/autotel-schema/snapshots/agent-security.snapshot.json`](../packages/autotel-schema/snapshots/agent-security.snapshot.json).
Import `AGENT_SECURITY_TELEMETRY_CONTRACT` from `autotel-schema` for CI diff gates.

```bash
autotel-schema diff snapshots/agent-security.snapshot.json current.json
```

## Triage

```bash
autotel security summary --lookback-minutes 60
autotel security mcp --lookback-minutes 60
autotel security events --severity error --lookback-minutes 240
```

## What NOT to log

Never emit raw prompts, retrieved documents, tool arguments/results, or reasoning
traces. Use hashes (`tool.input_hash`, `hashIdentifier`) and bounded summaries
(`decision.summary`) instead. See [Security Observability](./SECURITY-OBSERVABILITY.md#what-not-to-log).

## Further reading

- [Security Observability](./SECURITY-OBSERVABILITY.md) — cross-cutting `security.*` hooks
- [AGENTS.md](../AGENTS.md) — agent governance API quick reference
- Google Secure AI Agents introduction (May 2025) — principles this doc maps to
