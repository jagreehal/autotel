import { securityEvent } from 'autotel-audit';
import { resolveContext, toAttributeValue, type AgentContext } from './context.js';

/** Canonical plan-risk attribute keys (Google SAIF plan-risk predictor aligned). */
export const AGENT_PLAN_RISK_ATTR = {
  verdict: 'agent.plan.risk.verdict',
  score: 'agent.plan.risk.score',
  categories: 'agent.plan.risk.categories',
  toolSequence: 'agent.plan.risk.tool_sequence',
} as const;

export type AgentPlanRiskVerdict = 'low' | 'medium' | 'high' | 'critical';

export interface AgentPlanClassifierInput {
  /** Proposed tool names in execution order. */
  toolSequence: string[];
  stepIndex?: number;
  summary?: string;
  policyIds?: string[];
  /** Extra context attrs (scopes, intents) — values are coerced for OTel. */
  context?: Record<string, unknown>;
}

export interface AgentPlanClassifierResult {
  verdict: AgentPlanRiskVerdict;
  /** 0..1 risk score from the classifier. */
  score?: number;
  categories?: string[];
  reason?: string;
}

export type AgentPlanClassifier = (
  input: AgentPlanClassifierInput,
) =>
  | AgentPlanClassifierResult
  | undefined
  | Promise<AgentPlanClassifierResult | undefined>;

export interface RecordPlanRiskAssessmentOptions {
  ctx?: AgentContext;
  assessment: AgentPlanClassifierResult;
  toolSequence?: string[];
  /** Emit `llm.plan.risk.elevated` when verdict is not `low`. Default false. */
  emitSecurityEvent?: boolean;
}

function setPlanRiskAttrs(
  ctx: AgentContext | undefined,
  attrs: Record<string, unknown>,
): void {
  const traceCtx = resolveContext(ctx);
  const mapped: Record<string, string | number | boolean | string[] | number[] | boolean[]> =
    {};
  for (const [key, value] of Object.entries(attrs)) {
    const attr = toAttributeValue(value);
    if (attr !== undefined) {
      mapped[key] = attr;
    }
  }
  if (Object.keys(mapped).length > 0) {
    traceCtx.setAttributes(mapped);
  }
}

/**
 * Stamp plan-risk assessment attrs on the active span.
 */
export function recordPlanRiskAssessment(
  options: RecordPlanRiskAssessmentOptions,
): void {
  const { assessment, toolSequence } = options;
  setPlanRiskAttrs(options.ctx, {
    [AGENT_PLAN_RISK_ATTR.verdict]: assessment.verdict,
    ...(assessment.score !== undefined && {
      [AGENT_PLAN_RISK_ATTR.score]: assessment.score,
    }),
    ...(assessment.categories?.length && {
      [AGENT_PLAN_RISK_ATTR.categories]: assessment.categories,
    }),
    ...(toolSequence?.length && {
      [AGENT_PLAN_RISK_ATTR.toolSequence]: toolSequence,
    }),
    ...(assessment.reason !== undefined && { 'decision.summary': assessment.reason }),
  });

  if (
    options.emitSecurityEvent &&
    assessment.verdict !== 'low'
  ) {
    securityEvent(
      {
        name: 'llm.plan.risk.elevated',
        category: 'llm',
        outcome: assessment.verdict === 'critical' ? 'blocked' : 'denied',
        severity:
          assessment.verdict === 'critical'
            ? 'critical'
            : assessment.verdict === 'high'
              ? 'error'
              : 'warning',
        reason: assessment.reason ?? assessment.verdict,
        ...(assessment.score !== undefined && { score: assessment.score }),
        ...(assessment.categories?.length && {
          categories: assessment.categories.join(','),
        }),
      },
      { ctx: options.ctx },
    );
  }
}

/**
 * Run a pluggable plan-risk classifier and record its verdict on the span.
 * Classifier failures degrade quietly (no assessment recorded).
 */
export async function runAgentPlanClassifier(
  classifier: AgentPlanClassifier,
  input: AgentPlanClassifierInput,
  options: Omit<RecordPlanRiskAssessmentOptions, 'assessment'> = {},
): Promise<AgentPlanClassifierResult | undefined> {
  let assessment: AgentPlanClassifierResult | undefined;
  try {
    assessment = await classifier(input);
  } catch {
    return undefined;
  }
  if (!assessment) return undefined;
  recordPlanRiskAssessment({
    ...options,
    assessment,
    toolSequence: input.toolSequence,
  });
  return assessment;
}

const DESTRUCTIVE_TOOL = /\b(delete|remove|send|post|transfer|pay|upload|execute)\b/i;
const UNTRUSTED_READ = /\b(read|fetch|get|search|load|parse|inbox|email|web|scrape)\b/i;

/**
 * Dependency-free first-pass plan-risk heuristic. Opt-in — pass as
 * `AgentPlanClassifier` or wrap your own Model Armor / Llama Guard adapter.
 */
export function heuristicPlanRiskClassifier(): AgentPlanClassifier {
  return ({ toolSequence }) => {
    if (toolSequence.length === 0) {
      return { verdict: 'low', score: 0 };
    }

    const normalized = toolSequence.map((name) => name.replaceAll('_', ' '));
    const hasDestructive = normalized.some((name) => DESTRUCTIVE_TOOL.test(name));
    const hasUntrustedRead = normalized.some((name) => UNTRUSTED_READ.test(name));

    if (hasDestructive && hasUntrustedRead) {
      return {
        verdict: 'high',
        score: 0.85,
        categories: ['untrusted_to_destructive_chain'],
        reason: 'mixed_untrusted_and_destructive_tools',
      };
    }

    if (toolSequence.length >= 8) {
      return {
        verdict: 'medium',
        score: 0.55,
        categories: ['long_tool_chain'],
        reason: 'long_tool_sequence',
      };
    }

    return { verdict: 'low', score: 0.1 };
  };
}
