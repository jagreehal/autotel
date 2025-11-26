/**
 * Multi-Agent Workflow Example
 *
 * Demonstrates:
 * - Multi-agent orchestration (Triage → Specialist → QA)
 * - Correlation ID propagation
 * - Agent handoff tracking
 * - Business event instrumentation
 * - Workflow completion metrics
 *
 * This example uses simulated LLM calls to demonstrate instrumentation patterns.
 * In production, replace with actual LLM SDK calls (OpenAI, Anthropic, Vercel AI SDK, etc.)
 * and enable OpenLLMetry for automatic LLM instrumentation.
 */

import { init, trace, track, shutdown, type TraceContext } from 'autotel';
import 'dotenv/config';

// Initialize autotel with OpenLLMetry integration
init({
  service: 'multi-agent-example',
  environment: process.env.NODE_ENV || 'development',
  endpoint: process.env.OTLP_ENDPOINT,
  // Optional: Enable OpenLLMetry for automatic LLM instrumentation
  // openllmetry: {
  //   enabled: true,
  //   options: {
  //     disableBatch: process.env.NODE_ENV !== 'production',
  //   },
  // },
});

// ======================
// Simulated LLM Functions
// ======================

/**
 * Simulates an LLM call with delay
 * In production: replace with actual LLM SDK
 */
async function simulateLLMCall(prompt: string, model: string): Promise<string> {
  await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));
  return `[${model} response to: ${prompt.substring(0, 50)}...]`;
}

// ======================
// Agent Implementations
// ======================

/**
 * Agent 1: Triage Agent
 * - Analyzes incoming requests
 * - Creates action plans
 * - Determines if specialist is needed
 */
type TriageResult = {
  plan: string;
  requiresSpecialist: boolean;
  complexity: 'medium' | 'high' | 'low';
};

const triageAgent = trace<[string], Promise<TriageResult>>(
  'agent.triage',
  (ctx: TraceContext) => async (userRequest: string): Promise<TriageResult> => {
  ctx.setAttributes({
    'agent.role': 'triage',
    'agent.model': 'gpt-4o-mini',
    'agent.provider': 'openai',
  });

  // Simulate LLM call to analyze request
  const plan = await simulateLLMCall(
    `Analyze this request and create a plan: ${userRequest}`,
    'gpt-4o-mini'
  );

  // Track business metrics
  ctx.setAttributes({
    'request.length': userRequest.length,
    'plan.length': plan.length,
    'triage.task_count': 3,
    'triage.complexity': 'medium',
  });

  track('agent.triage_completed', {
    request_length: userRequest.length,
    plan_length: plan.length,
  });

  return {
    plan,
    requiresSpecialist: true,
    complexity: 'medium',
  };
  },
);

/**
 * Agent 2: Specialist Agent
 * - Executes detailed analysis
 * - Performs specialized tasks
 * - Generates comprehensive responses
 */
type SpecialistResult = {
  response: string;
  requiresQA: boolean;
  qualityScore: number;
};

const specialistAgent = trace<[string], Promise<SpecialistResult>>(
  'agent.specialist',
  (ctx: TraceContext) => async (plan: string): Promise<SpecialistResult> => {
  ctx.setAttributes({
    'agent.role': 'specialist',
    'agent.model': 'gpt-4o',
    'agent.provider': 'openai',
  });

  ctx.setAttribute('specialist.engaged', true);

  // Simulate detailed LLM processing
  const response = await simulateLLMCall(
    `Execute this plan with detailed analysis: ${plan}`,
    'gpt-4o'
  );

  ctx.setAttributes({
    'response.length': response.length,
    'response.quality_score': 0.87,
  });

  track('agent.specialist_completed', {
    plan_length: plan.length,
    response_length: response.length,
    quality_score: 0.87,
  });

  return {
    response,
    requiresQA: true,
    qualityScore: 0.87,
  };
  },
);

/**
 * Agent 3: QA Agent
 * - Reviews specialist output
 * - Validates quality
 * - Determines if follow-up is needed
 */
type QAResult = {
  approved: boolean;
  feedback: string;
  requiresFollowUp: boolean;
  score: number;
};

const qaAgent = trace<[string], Promise<QAResult>>(
  'agent.qa',
  (ctx: TraceContext) => async (response: string): Promise<QAResult> => {
  ctx.setAttributes({
    'agent.role': 'qa',
    'agent.model': 'gpt-4o',
    'agent.provider': 'openai',
  });

  ctx.setAttribute('qa.review_started', true);

  // Simulate QA evaluation
  const evaluation = await simulateLLMCall(
    `Review this response for quality: ${response}`,
    'gpt-4o'
  );

  // Random approval for demonstration
  const approved = Math.random() > 0.2;
  const requiresFollowUp = !approved;

  ctx.setAttributes({
    'qa.approved': approved,
    'qa.requires_follow_up': requiresFollowUp,
    'qa.score': approved ? 92 : 68,
  });

  ctx.setAttribute('qa.status', approved ? 'approved' : 'rejected');

  track('agent.qa_completed', {
    approved,
    requires_follow_up: requiresFollowUp,
    score: approved ? 92 : 68,
  });

  return {
    approved,
    feedback: evaluation,
    requiresFollowUp,
    score: approved ? 92 : 68,
  };
  },
);

// ======================
// Workflow Orchestrator
// ======================

/**
 * Main workflow: Orchestrates multi-agent escalation
 * - Coordinates agent handoffs
 * - Tracks correlation across all agents
 * - Captures workflow-level metrics
 */
type MultiAgentMetrics = {
  agentsInvolved: number;
  duration: number;
  finalApproval: boolean;
};

type MultiAgentResult = {
  plan: string;
  response: string | undefined;
  qa: QAResult | undefined;
  metrics: MultiAgentMetrics;
};

const runMultiAgentWorkflow = trace<[string, string], Promise<MultiAgentResult>>(
  'workflow.multi_agent_escalation',
  (ctx: TraceContext) => async (
    userRequest: string,
    userId: string,
  ): Promise<MultiAgentResult> => {
  const startTime = performance.now();

  // Set workflow-level attributes
  ctx.setAttributes({
    'workflow.type': 'multi_agent_escalation',
    'workflow.user_id': userId,
    'workflow.correlation_id': ctx.correlationId, // Auto-generated!
  });

  console.log(`\n🔄 Starting workflow`);
  console.log(`   Trace ID: ${ctx.traceId}`);
  console.log(`   Correlation ID: ${ctx.correlationId}`);
  console.log(`   User ID: ${userId}\n`);

  // Step 1: Triage
  console.log('📋 Step 1: Triage Agent');
  const triage = await triageAgent(userRequest);
  ctx.setAttributes({
    'triage.complete': true,
    'triage.requires_specialist': triage.requiresSpecialist,
    'triage.complexity': triage.complexity,
  });
  console.log(`   ✓ Plan created (${triage.plan.length} chars)`);

  // Step 2: Specialist (conditional)
  let specialistResult;
  if (triage.requiresSpecialist) {
    console.log('\n🔧 Step 2: Specialist Agent');
    specialistResult = await specialistAgent(triage.plan);
    ctx.setAttributes({
      'specialist.complete': true,
      'specialist.requires_qa': specialistResult.requiresQA,
      'specialist.quality_score': specialistResult.qualityScore,
    });
    console.log(`   ✓ Response generated (quality: ${specialistResult.qualityScore})`);
  } else {
    console.log('\n⏭️  Step 2: Skipped (specialist not needed)');
  }

  // Step 3: QA (conditional)
  let qaResult;
  if (specialistResult?.requiresQA) {
    console.log('\n✅ Step 3: QA Agent');
    qaResult = await qaAgent(specialistResult.response);
    ctx.setAttributes({
      'qa.complete': true,
      'qa.approved': qaResult.approved,
      'qa.final_score': qaResult.score,
    });
    console.log(`   ${qaResult.approved ? '✓' : '✗'} QA ${qaResult.approved ? 'Approved' : 'Rejected'} (score: ${qaResult.score})`);
  } else {
    console.log('\n⏭️  Step 3: Skipped (QA not needed)');
  }

  // Calculate workflow metrics
  const agentsInvolved = 1 + (specialistResult ? 1 : 0) + (qaResult ? 1 : 0);
  const workflowDuration = Math.round(performance.now() - startTime);

  ctx.setAttributes({
    'workflow.agents_involved': agentsInvolved,
    'workflow.duration_ms': workflowDuration,
    'workflow.final_approval': qaResult?.approved ?? true,
  });

  // Track workflow completion
  track('workflow.completed', {
    workflow_type: 'multi_agent_escalation',
    user_id: userId,
    agents_involved: agentsInvolved,
    final_approval: qaResult?.approved ?? true,
    duration_ms: workflowDuration,
  });

  console.log(`\n📊 Workflow Complete:`);
  console.log(`   Agents involved: ${agentsInvolved}`);
  console.log(`   Duration: ${workflowDuration}ms`);
  console.log(`   Final approval: ${qaResult?.approved ?? true}`);
  console.log(`   Correlation ID: ${ctx.correlationId}\n`);

  return {
    plan: triage.plan,
    response: specialistResult?.response,
    qa: qaResult,
    metrics: {
      agentsInvolved,
      duration: workflowDuration,
      finalApproval: qaResult?.approved ?? true,
    },
  };
  },
);

// ======================
// Run Example
// ======================

async function main() {
  console.log('='.repeat(60));
  console.log('Multi-Agent Workflow Example');
  console.log('='.repeat(60));

  // Example 1: High priority support request
  await runMultiAgentWorkflow(
    'Our production API is returning 500 errors for all POST requests to /api/orders. This started 10 minutes ago and is affecting 100+ customers.',
    'user-123'
  );

  // Example 2: Simple inquiry (for comparison)
  await runMultiAgentWorkflow(
    'How do I reset my password?',
    'user-456'
  );

  // Graceful shutdown - flushes all telemetry
  console.log('\n📤 Flushing telemetry...');
  await shutdown();
  console.log('✓ Complete!\n');
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
