/**
 * Type definitions for Cloudflare Agents SDK observability integration
 */

import type { Attributes } from '@opentelemetry/api';
import type { ConfigurationOption } from 'autotel-edge';
import type { AgentObservabilityEvent } from './agent';
import type { BaseEvent } from './base';
import type { MCPObservabilityEvent } from './mcp';
import type {
  ChannelEventMap,
  Observability,
  ObservabilityEvent,
} from './observability';

export type { BaseEvent, AgentObservabilityEvent, MCPObservabilityEvent };
export type { Observability, ObservabilityEvent, ChannelEventMap };

export type ObservabilityExecutionContext = DurableObjectState | ExecutionContext;

export interface AgentInstrumentationOptions {
  traceRpc?: boolean;
  traceSchedule?: boolean;
  traceQueue?: boolean;
  traceSubmissions?: boolean;
  traceMcp?: boolean;
  traceStateUpdates?: boolean;
  traceMessages?: boolean;
  traceLifecycle?: boolean;
  traceChat?: boolean;
  traceTranscripts?: boolean;
  traceFibers?: boolean;
  traceToolRecovery?: boolean;
  traceWorkflow?: boolean;
  traceEmail?: boolean;
  attributeExtractor?: (event: ObservabilityEvent) => Attributes;
  spanNameFormatter?: (event: ObservabilityEvent) => string;
}

export type OtelObservabilityConfig = ConfigurationOption & {
  agents?: AgentInstrumentationOptions;
};

export interface AgentSpanAttributes {
  'agent.event.type': string;
  'agent.event.id'?: string;
  'agent.class'?: string;
  'agent.instance.name'?: string;
  'agent.display_message'?: string;
  'agent.framework'?: string;
  'gen_ai.agent.name'?: string;
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
