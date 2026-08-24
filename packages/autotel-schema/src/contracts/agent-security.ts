import { defineContract } from '../contract.js';

const stringAttr = { type: 'string' as const };
const boolAttr = { type: 'boolean' as const };
const numberAttr = { type: 'number' as const };
const stringArrayAttr = { type: 'string[]' as const };

/**
 * Published telemetry contract for Google SAIF-aligned agent security observability.
 * Span names are illustrative — attributes are the stable surface under validation.
 */
export const AGENT_SECURITY_TELEMETRY_CONTRACT = defineContract({
  service: 'autotel-agent-security',
  version: '1.0.0',
  commonAttributes: {
    'autotel.agent': {
      ...boolAttr,
      required: false,
      description: 'Agent audit marker',
    },
    'agent.controller.id': {
      ...stringAttr,
      highCardinality: true,
      description: 'Hashed controlling human user id',
    },
    'agent.input.provenance': {
      ...stringAttr,
      enum: [
        'user_direct',
        'user_voice',
        'rag',
        'memory',
        'tool_result',
        'external_untrusted',
      ],
    },
    'agent.action.risk_class': {
      ...stringAttr,
      enum: [
        'read',
        'write',
        'destructive',
        'financial',
        'exfiltration_capable',
      ],
    },
    'agent.consent.required': { ...boolAttr },
    'agent.consent.outcome': {
      ...stringAttr,
      enum: ['approved', 'denied', 'timeout', 'revoked'],
    },
    'agent.consent.evidence': {
      ...stringAttr,
      enum: ['observed', 'inferred'],
      description:
        'Whether the consent outcome was witnessed or reconstructed. Defaults to inferred: no runtime reports the human click, so an approval deduced from the tool having run must never be cited as a human decision.',
    },
    'agent.scope.active': { ...stringArrayAttr },
    'agent.memory.operation': {
      ...stringAttr,
      enum: ['read', 'write', 'delete', 'search'],
    },
    'agent.memory.isolation_key': { ...stringAttr, highCardinality: true },
    'agent.plan.step_index': { ...numberAttr },
    'agent.plan.tool_intents': { ...stringArrayAttr },
    'agent.plan.risk.verdict': {
      ...stringAttr,
      enum: ['low', 'medium', 'high', 'critical'],
    },
    'agent.plan.risk.score': { ...numberAttr },
    'agent.plan.risk.categories': { ...stringArrayAttr },
    'policy.decision': {
      ...stringAttr,
      enum: ['permit', 'deny', 'challenge', 'observe', 'error'],
    },
    'tool.input_hash': { ...stringAttr },
    'tool.output_hash': { ...stringAttr },
    'mcp.tool.destructive': { ...boolAttr },
    'mcp.tool.untrusted_content': { ...boolAttr },
    'mcp.security.injection.verdict': {
      ...stringAttr,
      enum: ['clean', 'suspicious', 'malicious'],
    },
    'detection.correlation_id': {
      ...stringAttr,
      highCardinality: true,
      description: 'Session the detection belongs to',
    },
    'detection.rule_id': {
      ...stringAttr,
      description: 'Sequence rule that fired',
    },
    'detection.severity': {
      ...stringAttr,
      enum: ['low', 'medium', 'high', 'critical'],
      description: 'Severity of the rule that fired',
    },
    'detection.first_at': {
      ...numberAttr,
      description: 'Epoch ms of the first step matched by the rule',
    },
    'detection.last_at': {
      ...numberAttr,
      description: 'Epoch ms of the last step matched by the rule',
    },
    'detection.steps': {
      ...numberAttr,
      description: 'How many ordered steps the rule matched',
    },
    'detection.disposition.status': {
      ...stringAttr,
      enum: [
        'new',
        'acknowledged',
        'in_progress',
        'resolved',
        'false_positive',
        'risk_accepted',
      ],
      description: 'Triage decision recorded against a detection',
    },
    'detection.disposition.note': {
      ...stringAttr,
      // Deliberately NOT highCardinality: that flag is a redaction protect-list,
      // and this is free text a human typed. It is the likeliest field in the
      // contract to carry a pasted secret or a customer name, so it must stay
      // subject to the redactor rather than exempt from it.
      description:
        'Why the finding was closed. Required for false_positive and risk_accepted.',
    },
    'detection.disposition.supersedes': {
      ...stringAttr,
      enum: [
        'new',
        'acknowledged',
        'in_progress',
        'resolved',
        'false_positive',
        'risk_accepted',
      ],
      description:
        'Status this decision replaces — dispositions are appended, never edited, so a reversal survives.',
    },
    'security.event': { ...stringAttr },
    'security.category': { ...stringAttr },
    'security.outcome': { ...stringAttr },
    'security.severity': {
      ...stringAttr,
      enum: ['info', 'warning', 'error', 'critical'],
    },
  },
  spans: {
    'agent.action': {
      description: 'Scoped agent action or tool call with audit metadata',
      attributes: {
        'agent.id': { ...stringAttr, required: true },
        'tool.name': { ...stringAttr },
      },
    },
    'tools/call': {
      description: 'MCP tool invocation with boundary security signals',
      attributes: {
        'mcp.tool.name': { ...stringAttr, required: true },
      },
    },
  },
});
