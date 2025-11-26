/**
 * Cloudflare Agents SDK observability integration
 *
 * Provides an OpenTelemetry-based Observability implementation for the
 * Cloudflare Agents SDK (https://github.com/cloudflare/agents).
 *
 * @example
 * ```typescript
 * import { Agent } from 'agents'
 * import { createOtelObservability } from 'autotel-cloudflare/agents'
 *
 * class MyAgent extends Agent<Env> {
 *   // Override the observability property with OpenTelemetry
 *   observability = createOtelObservability({
 *     service: { name: 'my-agent' }
 *   })
 *
 *   @callable()
 *   async doSomething() {
 *     // This RPC call will be automatically traced
 *     return 'done'
 *   }
 * }
 * ```
 *
 * @packageDocumentation
 */

export {
  createOtelObservability,
  createOtelObservabilityFromEnv,
  OtelObservability,
} from './otel-observability';
export type {
  OtelObservabilityConfig,
  AgentObservabilityEvent,
  MCPObservabilityEvent,
  ObservabilityEvent,
  Observability,
  AgentInstrumentationOptions,
  AgentSpanAttributes,
} from './types';
