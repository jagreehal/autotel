import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_SECURITY_ATTR,
  deriveActionRiskClass,
  recordHumanApproval,
  recordInputProvenance,
  recordPlanStep,
} from './agent-security.js';
import { otelTrace } from 'autotel';

const setAttribute = vi.fn();
const setAttributes = vi.fn();

vi.mock('autotel-audit', () => ({
  hashIdentifier: (value: string) => `hash:${value}`,
}));

vi.mock('autotel', () => ({
  otelTrace: {
    getActiveSpan: vi.fn(),
  },
}));

vi.mock('./context.js', () => ({
  resolveContext: () => ({
    traceId: 'trace-1',
    spanId: 'span-1',
    correlationId: 'corr-1',
    setAttribute,
    setAttributes,
  }),
  resolveContextSafe: () => ({
    traceId: 'trace-1',
    spanId: 'span-1',
    correlationId: 'corr-1',
    setAttribute,
    setAttributes,
  }),
  toAttributeValue: (value: unknown) => value,
}));

describe('agent-security', () => {
  beforeEach(() => {
    setAttribute.mockClear();
    setAttributes.mockClear();
    vi.mocked(otelTrace.getActiveSpan).mockReturnValue();
  });

  it('deriveActionRiskClass prefers explicit override', () => {
    expect(
      deriveActionRiskClass({ destructiveHint: true }, 'read'),
    ).toBe('read');
  });

  it('deriveActionRiskClass maps MCP hints', () => {
    expect(deriveActionRiskClass({ readOnlyHint: true })).toBe('read');
    expect(deriveActionRiskClass({ destructiveHint: true })).toBe('destructive');
    expect(deriveActionRiskClass({ openWorldHint: true })).toBe('exfiltration_capable');
  });

  it('recordInputProvenance sets provenance attr', () => {
    recordInputProvenance({ provenance: 'rag' });
    expect(setAttribute).toHaveBeenCalledWith(
      AGENT_SECURITY_ATTR.inputProvenance,
      'rag',
    );
  });

  it('recordHumanApproval hashes controller and sets consent attrs', () => {
    recordHumanApproval({
      toolCallId: 'tc-1',
      approved: false,
      controllerId: 'user@example.com',
    });
    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        [AGENT_SECURITY_ATTR.consentRequired]: true,
        [AGENT_SECURITY_ATTR.consentOutcome]: 'denied',
        [AGENT_SECURITY_ATTR.controllerId]: 'hash:user@example.com',
        'tool.call.id': 'tc-1',
      }),
    );
  });

  it('recordPlanStep stamps bounded plan metadata', () => {
    recordPlanStep({
      stepIndex: 2,
      toolIntents: ['search'],
      summary: 'Look up docs',
    });
    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        [AGENT_SECURITY_ATTR.planStepIndex]: 2,
        [AGENT_SECURITY_ATTR.planToolIntents]: ['search'],
        'decision.summary': 'Look up docs',
      }),
    );
  });
});
