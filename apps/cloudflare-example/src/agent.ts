/**
 * Cloudflare Agents SDK example with autotel-cloudflare instrumentation
 *
 * This example demonstrates how to use the Cloudflare Agents SDK with autotel-cloudflare
 * to get comprehensive tracing of Agent RPC calls, scheduled tasks, MCP operations, and lifecycle events.
 *
 * @see https://github.com/cloudflare/agents
 */

import { Agent, callable } from 'agents';
import { createOtelObservability } from 'autotel-cloudflare/agents';
import { SamplingPresets } from 'autotel-cloudflare/sampling';
import type { worker } from '../alchemy.run.ts';

/**
 * Example Agent that demonstrates:
 * - RPC method tracing (via @callable decorator)
 * - Scheduled task tracing
 * - MCP (Model Context Protocol) operation tracing
 * - Lifecycle event tracing (connect, destroy)
 * - Message event tracing
 */
class TaskAgent extends Agent<typeof worker.Env> {
  // Override observability with OpenTelemetry implementation
  // This replaces the default observability with full OpenTelemetry tracing
  // Initialize in constructor to access env
  observability;

  private taskCount = 0;

  constructor(state: DurableObjectState, env: typeof worker.Env) {
    super(state, env);
    
    // Initialize OpenTelemetry observability
    this.observability = createOtelObservability({
      exporter: {
        url: env.OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
        headers: env.OTLP_HEADERS ? JSON.parse(env.OTLP_HEADERS) : {},
      },
      service: {
        name: 'task-agent-service',
        version: '1.0.0',
      },
      // Adaptive sampling: 10% baseline, all errors, all slow requests (>1s)
      sampling: {
        tailSampler:
          env.ENVIRONMENT === 'production'
            ? SamplingPresets.production() // 10% baseline, all errors, slow >1s
            : SamplingPresets.development(), // 100% in dev
      },
      // Agent-specific instrumentation options
      agents: {
        traceRpc: true, // Trace RPC calls (default: true)
        traceSchedule: true, // Trace scheduled tasks (default: true)
        traceMcp: true, // Trace MCP operations (default: true)
        traceStateUpdates: false, // Skip state updates (default: false, can be noisy)
        traceMessages: true, // Trace message events (default: true)
        traceLifecycle: true, // Trace connect/destroy (default: true)
      },
    });
  }

  /**
   * Example RPC method - automatically traced when called
   * The @callable() decorator makes this method callable via RPC
   */
  @callable()
  async processTask(taskName: string, priority: number = 1): Promise<{ result: string; taskId: string }> {
    this.taskCount++;
    const taskId = `task-${Date.now()}-${this.taskCount}`;

    // Simulate task processing
    await new Promise((resolve) => setTimeout(resolve, 100));

    return {
      result: `Processed ${taskName} with priority ${priority}`,
      taskId,
    };
  }

  /**
   * Example RPC method with error handling
   * Errors are automatically traced with proper span status
   */
  @callable()
  async processTaskWithError(taskName: string): Promise<{ result: string }> {
    if (taskName === 'error') {
      throw new Error('Simulated error for testing');
    }

    return {
      result: `Successfully processed ${taskName}`,
    };
  }

  /**
   * Example scheduled task
   * Scheduled tasks are automatically traced when executed
   */
  @callable()
  async scheduledCleanup(): Promise<void> {
    // This would be called on a schedule
    // The schedule execution is automatically traced
    console.log('Running scheduled cleanup');
    this.taskCount = 0; // Reset counter
  }

  /**
   * Example method that uses MCP (Model Context Protocol)
   * MCP operations are automatically traced
   */
  @callable()
  async callMcpServer(serverId: string, method: string, params?: Record<string, unknown>): Promise<unknown> {
    // MCP client operations are automatically traced
    // This is a simplified example - actual MCP usage would involve
    // connecting to MCP servers and making requests
    return {
      serverId,
      method,
      params,
      result: 'MCP operation completed',
    };
  }

  /**
   * Example method that sends messages
   * Message events are automatically traced
   */
  @callable()
  async sendMessage(recipient: string, message: string): Promise<{ messageId: string }> {
    // Message sending is automatically traced
    const messageId = `msg-${Date.now()}`;
    return { messageId };
  }

  /**
   * Get agent statistics
   * Note: this.name may not be set before routeAgentRequest is used
   * See: https://github.com/cloudflare/workerd/issues/2240
   */
  @callable()
  async getStats(): Promise<{ taskCount: number; agentId: string }> {
    let agentId = 'unknown';
    try {
      agentId = this.name || 'unknown';
    } catch {
      // this.name not set yet - known workerd issue
    }
    return {
      taskCount: this.taskCount,
      agentId,
    };
  }
}

/**
 * Export the Agent class
 */
export { TaskAgent };

/**
 * Export the Agent class as default for Durable Object binding
 */
export default TaskAgent;

