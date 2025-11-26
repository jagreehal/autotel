/**
 * Type definitions for Cloudflare Agents SDK observability integration
 */

import type { ConfigurationOption } from 'autotel-edge';
import type { Attributes } from '@opentelemetry/api';

/**
 * Base event structure from Agents SDK (mirrors agents/src/observability/base.ts)
 */
export interface BaseAgentEvent<
  T extends string,
  Payload extends Record<string, unknown> = Record<string, unknown>
> {
  type: T;
  /** Unique identifier for the event */
  id: string;
  /** Human-readable message for logging */
  displayMessage: string;
  /** Event payload with type-specific data */
  payload: Payload & Record<string, unknown>;
  /** Timestamp in milliseconds since epoch */
  timestamp: number;
}

/**
 * Agent-specific observability events
 */
export type AgentObservabilityEvent =
  | BaseAgentEvent<'state:update', Record<string, unknown>>
  | BaseAgentEvent<
      'rpc',
      {
        method: string;
        streaming?: boolean;
      }
    >
  | BaseAgentEvent<'message:request' | 'message:response', Record<string, unknown>>
  | BaseAgentEvent<'message:clear'>
  | BaseAgentEvent<
      'schedule:create' | 'schedule:execute' | 'schedule:cancel',
      {
        callback: string;
        id: string;
      }
    >
  | BaseAgentEvent<'destroy'>
  | BaseAgentEvent<
      'connect',
      {
        connectionId: string;
      }
    >;

/**
 * MCP-specific observability events
 */
export type MCPObservabilityEvent =
  | BaseAgentEvent<'mcp:client:preconnect', { serverId: string }>
  | BaseAgentEvent<
      'mcp:client:connect',
      { url: string; transport: string; state: string; error?: string }
    >
  | BaseAgentEvent<
      'mcp:client:authorize',
      {
        serverId: string;
        authUrl: string;
        clientId?: string;
      }
    >
  | BaseAgentEvent<'mcp:client:discover', Record<string, unknown>>;

/**
 * Union of all observability event types
 */
export type ObservabilityEvent = AgentObservabilityEvent | MCPObservabilityEvent;

/**
 * Observability interface from Agents SDK
 */
export interface Observability {
  /**
   * Emit an event for the Agent's observability implementation to handle.
   * @param event - The event to emit
   * @param ctx - The execution context of the invocation (optional)
   */
  emit(event: ObservabilityEvent, ctx?: DurableObjectState): void;
}

/**
 * Agent-specific instrumentation options
 */
export interface AgentInstrumentationOptions {
  /**
   * Whether to create spans for RPC calls
   * @default true
   */
  traceRpc?: boolean;

  /**
   * Whether to create spans for schedule operations
   * @default true
   */
  traceSchedule?: boolean;

  /**
   * Whether to create spans for MCP operations
   * @default true
   */
  traceMcp?: boolean;

  /**
   * Whether to create spans for state updates
   * @default false (can be noisy)
   */
  traceStateUpdates?: boolean;

  /**
   * Whether to create spans for message events
   * @default true
   */
  traceMessages?: boolean;

  /**
   * Whether to create spans for connect/destroy lifecycle events
   * @default true
   */
  traceLifecycle?: boolean;

  /**
   * Custom attribute extractor for events
   */
  attributeExtractor?: (event: ObservabilityEvent) => Attributes;

  /**
   * Custom span name formatter
   */
  spanNameFormatter?: (event: ObservabilityEvent) => string;
}

/**
 * Configuration for OtelObservability
 */
export type OtelObservabilityConfig = ConfigurationOption & {
  /**
   * Agent-specific instrumentation options
   */
  agents?: AgentInstrumentationOptions;
};

/**
 * Semantic attributes for Agent spans
 */
export interface AgentSpanAttributes {
  'agent.event.type': string;
  'agent.event.id': string;
  'agent.rpc.method'?: string;
  'agent.rpc.streaming'?: boolean;
  'agent.schedule.callback'?: string;
  'agent.schedule.id'?: string;
  'agent.connection.id'?: string;
  'agent.mcp.server_id'?: string;
  'agent.mcp.url'?: string;
  'agent.mcp.transport'?: string;
  'agent.mcp.state'?: string;
}
