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
 *     traceRpc: true,            // RPC and rpc:error
 *     traceSchedule: true,       // schedule:* events
 *     traceQueue: true,          // queue:* events
 *     traceSubmissions: true,    // submission:* events
 *     traceMcp: true,            // mcp:* events
 *     traceStateUpdates: false,  // state:update (off by default; noisy)
 *     traceMessages: true,       // message:* and tool:* events
 *     traceChat: true,           // chat:* recovery/stream/context events
 *     traceTranscripts: true,    // chat:transcript:* events
 *     traceFibers: true,         // fiber:* events
 *     traceToolRecovery: true,   // agent_tool:* recovery events
 *     traceWorkflow: true,       // workflow:* events
 *     traceEmail: true,          // email:* events
 *     traceLifecycle: true,      // connect/disconnect/destroy
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
export { channels, genericObservability, subscribe } from './agents/observability';
export type {
  BaseEvent,
  OtelObservabilityConfig,
  AgentObservabilityEvent,
  MCPObservabilityEvent,
  ObservabilityEvent,
  Observability,
  ChannelEventMap,
  AgentInstrumentationOptions,
  AgentSpanAttributes,
} from './agents/types';
