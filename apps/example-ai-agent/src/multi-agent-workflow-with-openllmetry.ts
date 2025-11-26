/**
 * Multi-Agent Workflow with OpenAI Agents Framework + OpenLLMetry
 *
 * This example demonstrates the recommended approach: using @openai/agents with autotel + OpenLLMetry.
 *
 * Architecture:
 * - @openai/agents: Provides multi-agent orchestration, handoffs, and tools
 * - OpenLLMetry: Automatic instrumentation of OpenAI SDK calls (prompts, tokens, model params)
 * - autotel trace(): Wraps the workflow for correlation and business metrics
 *
 * Expected Spans (verified):
 * ✅ workflow.multi_agent_escalation - Root span from autotel trace()
 * ✅ openai.chat (×2) - LLM call spans auto-created by OpenLLMetry (one per agent)
 * ✅ @traceloop/instrumentation-openai - OpenLLMetry instrumentation layer
 *
 * Total: 4 spans - All share the same traceId for perfect correlation.
 * View traces by filtering for the correlation ID printed at runtime.
 *
 * Compare with multi-agent-workflow.ts which uses simulated LLM calls (no OpenLLMetry).
 */

import { init, trace, track, shutdown, type TraceContext } from 'autotel';
import { ConsoleSpanExporter } from 'autotel/exporters';
import { Agent, handoff, run, setDefaultOpenAIClient, setOpenAIAPI } from '@openai/agents';
import OpenAI from 'openai';
import 'dotenv/config';

// ======================
// Initialize Observability
// ======================

// Use ConsoleSpanExporter to print all spans for verification
const consoleExporter = new ConsoleSpanExporter();

// Initialize autotel with built-in OpenLLMetry support
// This is the recommended approach - everything configured in one place
init({
  service: 'multi-agent-example-with-openllmetry',
  environment: process.env.NODE_ENV || 'development',

  // Span exporter for traces
  spanExporter: consoleExporter,

  // Enable OpenLLMetry for automatic LLM instrumentation
  openllmetry: {
    enabled: true,
    options: {
      disableBatch: true,
      baseUrl: '', // Disable cloud export
      instrumentModules: {
        openAI: OpenAI,
      },
    },
  },

  // Enable logging to see what's happening
  logger: console,
});

// ======================
// Configure OpenAI Client
// ======================

// Configure OpenAI SDK to use Ollama's endpoint
// OpenLLMetry instruments the official OpenAI SDK automatically
const openai = new OpenAI({
  baseURL: 'http://localhost:11434/v1',
  apiKey: 'ollama', // Ollama doesn't validate the API key
});

// Configure @openai/agents to use Chat Completions API (not Responses API)
// Ollama only supports the Chat Completions API
setOpenAIAPI('chat_completions');

// Set as default client for all agents
setDefaultOpenAIClient(openai);

// ======================
// Define Agents using @openai/agents Framework
// ======================

/**
 * Specialist Agent
 *
 * Handles detailed technical analysis and provides comprehensive responses.
 * Uses Ollama's gpt-oss:20b model via OpenAI-compatible API.
 */
const specialistAgent = new Agent({
  name: 'Specialist Agent',
  model: 'gpt-oss:20b',
  handoffDescription:
    'Expert agent that provides detailed technical analysis and comprehensive solutions',
  instructions: `You are a specialist agent providing detailed technical responses.
When you receive a request:
1. Analyze the technical details thoroughly
2. Provide a comprehensive, step-by-step solution
3. Be thorough and professional
4. Address all points in the request

Format your response clearly and include specific technical guidance.`,
});

/**
 * QA Agent
 *
 * Reviews specialist responses for quality and completeness.
 * Uses Ollama's gpt-oss:20b model via OpenAI-compatible API.
 */
const qaAgent = new Agent({
  name: 'QA Agent',
  model: 'gpt-oss:20b',
  handoffDescription: 'Quality assurance agent that reviews responses for accuracy and completeness',
  instructions: `You are a QA agent reviewing responses for quality.
Evaluate the response and provide:
1. Approval status (approve or reject)
2. Quality score (0-100)
3. Brief feedback on what's good or needs improvement

Format your response as JSON:
{
  "approved": true/false,
  "score": 0-100,
  "feedback": "Brief feedback on quality"
}`,
});

/**
 * Triage Agent
 *
 * Analyzes incoming requests and routes to appropriate specialists.
 * Uses Ollama's gpt-oss:20b model via OpenAI-compatible API.
 *
 * This is the entry point agent that can handoff to specialist or QA agents.
 */
const triageAgent = new Agent({
  name: 'Triage Agent',
  model: 'gpt-oss:20b',
  handoffDescription: 'Initial triage agent that analyzes requests and routes to specialists',
  instructions: `You are a triage agent analyzing customer requests.
Analyze the request and decide:
1. Request category (technical/billing/general)
2. Complexity level (low/medium/high)
3. Whether a specialist is needed

For technical requests that need detailed analysis, transfer to the Specialist Agent.

Format your initial assessment as JSON:
{
  "category": "technical/billing/general",
  "complexity": "low/medium/high",
  "plan": "Brief action plan (2-3 sentences)"
}

If the request needs specialist attention, transfer using the transfer_to_specialist function.`,
  handoffs: [handoff(specialistAgent, { toolDescriptionOverride: 'Transfer to specialist for detailed technical analysis' })],
});

// ======================
// Workflow Orchestration with autotel
// ======================

/**
 * Run Multi-Agent Workflow
 *
 * This wraps the @openai/agents execution with autotel's trace() to:
 * - Create a root workflow span
 * - Add business context (user ID, correlation ID)
 * - Track workflow-level metrics
 * - Correlate all agent and LLM spans together
 *
 * The @openai/agents framework handles:
 * - Agent orchestration and handoffs
 * - Tool execution
 * - State management
 *
 * OpenLLMetry automatically instruments:
 * - All OpenAI SDK calls made by the agents
 * - Prompts, completions, and token usage
 */
const runMultiAgentWorkflow = trace<[string, string], Promise<{
  response: string;
  agentsInvolved: string[];
  metrics: {
    duration: number;
    messageCount: number;
  };
}>>(
  'workflow.multi_agent_escalation',
  (ctx: TraceContext) =>
    async (
      userRequest: string,
      userId: string,
    ): Promise<{
      response: string;
      agentsInvolved: string[];
      metrics: { duration: number; messageCount: number };
    }> => {
      const startTime = performance.now();

      // Workflow-level business context
      ctx.setAttributes({
        'workflow.type': 'multi_agent_escalation',
        'workflow.user_id': userId,
        'workflow.correlation_id': ctx.correlationId,
        'request.length': userRequest.length,
      });

      console.log(`\n🔄 Multi-Agent Workflow Started`);
      console.log(`   Correlation ID: ${ctx.correlationId}`);

      const runner = await run(triageAgent, userRequest, { stream: true });

      // Stream agent events
      const agentsUsed = new Set<string>();
      let messageCount = 0;

      for await (const event of runner) {
        if (event.type === 'agent_updated_stream_event') {
          agentsUsed.add(event.agent.name);
        } else if (event.type === 'run_item_stream_event') {
          if (event.name === 'message_output_created') {
            messageCount++;
          }
        }
      }

      // Wait for stream to complete
      await runner.completed;

      // Get final output
      const finalResponse = runner.finalOutput
        ? typeof runner.finalOutput === 'string'
          ? runner.finalOutput
          : JSON.stringify(runner.finalOutput)
        : '';

      // Calculate metrics
      const duration = performance.now() - startTime;
      const agentsList = Array.from(agentsUsed);

      // Add workflow completion metrics
      ctx.setAttributes({
        'workflow.agents_involved': agentsList.length,
        'workflow.agent_names': agentsList.join(','),
        'workflow.duration_ms': duration,
        'workflow.message_count': messageCount,
        'response.length': finalResponse.length,
      });

      // Track business event
      track('workflow.multi_agent_completed', {
        agents_involved: agentsList.length,
        agent_names: agentsList,
        duration_ms: duration,
        message_count: messageCount,
        user_id: userId,
        correlation_id: ctx.correlationId,
      });

      console.log(`\n✓ Workflow complete: ${agentsList.join(' → ')} (${duration.toFixed(0)}ms)\n`);

      return {
        response: finalResponse,
        agentsInvolved: agentsList,
        metrics: {
          duration,
          messageCount,
        },
      };
    },
);

// ======================
// Main Execution
// ======================

async function main() {
  console.log('═'.repeat(60));
  console.log('Multi-Agent Workflow Example');
  console.log('═'.repeat(60));

  try {
    // Run workflow with example request
    const result = await runMultiAgentWorkflow(
      'I need help setting up monitoring and alerts for my Kubernetes cluster. Specifically looking for guidance on Prometheus configuration and Grafana dashboard setup.',
      'user_123',
    );

    console.log('─'.repeat(60));
    console.log('Result');
    console.log('─'.repeat(60));
    console.log(`Response: ${result.response.substring(0, 200)}...`);
    console.log(`Agents: ${result.agentsInvolved.join(' → ')}`);
    console.log(`Messages: ${result.metrics.messageCount}, Duration: ${result.metrics.duration.toFixed(0)}ms\n`);
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  } finally {
    // Flush all pending telemetry
    await shutdown();
    console.log('✓ Telemetry flushed\n');
  }
}

main().catch(console.error);
