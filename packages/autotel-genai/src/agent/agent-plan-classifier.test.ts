import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_PLAN_RISK_ATTR,
  heuristicPlanRiskClassifier,
  recordPlanRiskAssessment,
  runAgentPlanClassifier,
} from './agent-plan-classifier.js';

const setAttributes = vi.fn();

vi.mock('autotel-audit', () => ({
  securityEvent: vi.fn(),
}));

vi.mock('./context.js', () => ({
  resolveContext: () => ({
    traceId: 'trace-1',
    spanId: 'span-1',
    correlationId: 'corr-1',
    setAttribute: vi.fn(),
    setAttributes,
  }),
  toAttributeValue: (value: unknown) => value,
}));

describe('agent-plan-classifier', () => {
  beforeEach(() => {
    setAttributes.mockClear();
  });

  it('recordPlanRiskAssessment stamps verdict attrs', () => {
    recordPlanRiskAssessment({
      assessment: {
        verdict: 'high',
        score: 0.9,
        categories: ['untrusted_to_destructive_chain'],
        reason: 'mixed tools',
      },
      toolSequence: ['read_inbox', 'send_email'],
    });

    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        [AGENT_PLAN_RISK_ATTR.verdict]: 'high',
        [AGENT_PLAN_RISK_ATTR.score]: 0.9,
        [AGENT_PLAN_RISK_ATTR.categories]: ['untrusted_to_destructive_chain'],
        [AGENT_PLAN_RISK_ATTR.toolSequence]: ['read_inbox', 'send_email'],
        'decision.summary': 'mixed tools',
      }),
    );
  });

  it('heuristicPlanRiskClassifier flags untrusted then destructive sequences', async () => {
    const classify = heuristicPlanRiskClassifier();
    const result = await runAgentPlanClassifier(classify, {
      toolSequence: ['read_inbox', 'send_email'],
    });

    expect(result?.verdict).toBe('high');
    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        [AGENT_PLAN_RISK_ATTR.verdict]: 'high',
      }),
    );
  });

  it('runAgentPlanClassifier swallows classifier errors', async () => {
    const result = await runAgentPlanClassifier(
      () => {
        throw new Error('classifier down');
      },
      { toolSequence: ['search'] },
    );

    expect(result).toBeUndefined();
    expect(setAttributes).not.toHaveBeenCalled();
  });
});
