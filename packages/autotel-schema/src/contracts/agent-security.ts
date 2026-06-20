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
    'autotel.agent': { ...boolAttr, required: false, description: 'Agent audit marker' },
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
      enum: ['read', 'write', 'destructive', 'financial', 'exfiltration_capable'],
    },
    'agent.consent.required': { ...boolAttr },
    'agent.consent.outcome': {
      ...stringAttr,
      enum: ['approved', 'denied', 'timeout', 'revoked'],
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
