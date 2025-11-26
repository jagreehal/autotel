/**
 * Cloudflare Agents SDK integration entry point
 *
 * Provides an OpenTelemetry-based Observability implementation for the
 * Cloudflare Agents SDK (https://github.com/cloudflare/agents).
 *
 * @example Basic Usage
 * ```typescript
 * import { Agent } from 'agents'
 * import { createOtelObservability } from 'autotel-cloudflare/agents'
 *
 * class MyAgent extends Agent<Env> {
 *   // Replace default observability with OpenTelemetry
 *   observability = createOtelObservability({
 *     service: { name: 'my-agent' },
 *     exporter: { url: env.OTLP_ENDPOINT }
 *   })
 *
 *   @callable()
 *   async processTask(task: string) {
 *     // All RPC calls are automatically traced
 *     return { result: 'done' }
 *   }
 * }
 * ```
 *
 * @example Environment-Based Configuration
 * ```typescript
 * import { Agent } from 'agents'
 * import { createOtelObservabilityFromEnv, OtelObservability } from 'autotel-cloudflare/agents'
 *
 * class MyAgent extends Agent<Env> {
 *   observability?: OtelObservability
 *
 *   constructor(state: DurableObjectState, env: Env) {
 *     super(state, env)
 *     // Automatically reads OTEL_* environment variables
 *     this.observability = createOtelObservabilityFromEnv(env)
 *   }
 * }
 * ```
 *
 * @example Selective Tracing
 * ```typescript
 * import { createOtelObservability } from 'autotel-cloudflare/agents'
 *
 * const observability = createOtelObservability({
 *   service: { name: 'my-agent' },
 *   agents: {
 *     traceRpc: true,           // Trace RPC calls (default: true)
 *     traceSchedule: true,      // Trace scheduled tasks (default: true)
 *     traceMcp: true,           // Trace MCP operations (default: true)
 *     traceStateUpdates: false, // Skip state updates (default: false, can be noisy)
 *     traceMessages: true,      // Trace message events (default: true)
 *     traceLifecycle: true,     // Trace connect/destroy (default: true)
 *   }
 * })
 * ```
 *
 * @packageDocumentation
 */

export {
  createOtelObservability,
  createOtelObservabilityFromEnv,
  OtelObservability,
} from './agents/otel-observability';
export type {
  OtelObservabilityConfig,
  AgentObservabilityEvent,
  MCPObservabilityEvent,
  ObservabilityEvent,
  Observability,
  AgentInstrumentationOptions,
  AgentSpanAttributes,
} from './agents/types';
