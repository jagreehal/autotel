import type { AgentObservabilityEvent } from './agent';
import type { MCPObservabilityEvent } from './mcp';

export type ObservabilityEvent = AgentObservabilityEvent | MCPObservabilityEvent;

export interface Observability {
  emit(event: ObservabilityEvent, ctx?: DurableObjectState | ExecutionContext): void;
}

type ChannelKey =
  | 'state'
  | 'rpc'
  | 'message'
  | 'chat'
  | 'transcript'
  | 'fiber'
  | 'agentTool'
  | 'schedule'
  | 'lifecycle'
  | 'workflow'
  | 'mcp'
  | 'email';

export type ChannelEventMap = {
  state: Extract<ObservabilityEvent, { type: `state:${string}` }>;
  rpc: Extract<ObservabilityEvent, { type: 'rpc' | `rpc:${string}` }>;
  message: Extract<
    ObservabilityEvent,
    { type: `message:${string}` | `tool:${string}` | `submission:${string}` }
  >;
  chat: Exclude<
    Extract<ObservabilityEvent, { type: `chat:${string}` }>,
    { type: `chat:transcript:${string}` }
  >;
  transcript: Extract<
    ObservabilityEvent,
    { type: `transcript:${string}` | `chat:transcript:${string}` }
  >;
  fiber: Extract<ObservabilityEvent, { type: `fiber:${string}` }>;
  agentTool: Extract<ObservabilityEvent, { type: `agent_tool:${string}` }>;
  schedule: Extract<
    ObservabilityEvent,
    { type: `schedule:${string}` | `queue:${string}` }
  >;
  lifecycle: Extract<
    ObservabilityEvent,
    { type: 'connect' | 'disconnect' | 'destroy' }
  >;
  workflow: Extract<ObservabilityEvent, { type: `workflow:${string}` }>;
  mcp: Extract<ObservabilityEvent, { type: `mcp:${string}` }>;
  email: Extract<ObservabilityEvent, { type: `email:${string}` }>;
};

export interface ObservabilityChannel<TEvent extends ObservabilityEvent = ObservabilityEvent> {
  name: string;
  publish(event: TEvent): void;
}

const listeners: {
  [K in ChannelKey]: Set<(event: ChannelEventMap[K]) => void>;
} = {
  state: new Set(),
  rpc: new Set(),
  message: new Set(),
  chat: new Set(),
  transcript: new Set(),
  fiber: new Set(),
  agentTool: new Set(),
  schedule: new Set(),
  lifecycle: new Set(),
  workflow: new Set(),
  mcp: new Set(),
  email: new Set(),
};

function createChannel<K extends ChannelKey>(
  key: K,
  name: string,
): ObservabilityChannel<ChannelEventMap[K]> {
  return {
    name,
    publish(event) {
      for (const callback of listeners[key]) {
        callback(event);
      }
    },
  };
}

export const channels = {
  state: createChannel('state', 'agents:state'),
  rpc: createChannel('rpc', 'agents:rpc'),
  message: createChannel('message', 'agents:message'),
  chat: createChannel('chat', 'agents:chat'),
  transcript: createChannel('transcript', 'agents:transcript'),
  fiber: createChannel('fiber', 'agents:fiber'),
  agentTool: createChannel('agentTool', 'agents:agent_tool'),
  schedule: createChannel('schedule', 'agents:schedule'),
  lifecycle: createChannel('lifecycle', 'agents:lifecycle'),
  workflow: createChannel('workflow', 'agents:workflow'),
  mcp: createChannel('mcp', 'agents:mcp'),
  email: createChannel('email', 'agents:email'),
} as const;

function getChannel(type: string): ObservabilityChannel {
  if (type.startsWith('mcp:')) return channels.mcp;
  if (type.startsWith('workflow:')) return channels.workflow;
  if (type.startsWith('fiber:')) return channels.fiber;
  if (type.startsWith('transcript:') || type.startsWith('chat:transcript:')) {
    return channels.transcript;
  }
  if (type.startsWith('chat:')) return channels.chat;
  if (type.startsWith('agent_tool:')) return channels.agentTool;
  if (type.startsWith('schedule:') || type.startsWith('queue:')) {
    return channels.schedule;
  }
  if (
    type.startsWith('message:') ||
    type.startsWith('tool:') ||
    type.startsWith('submission:')
  ) {
    return channels.message;
  }
  if (type === 'rpc' || type.startsWith('rpc:')) return channels.rpc;
  if (type.startsWith('state:')) return channels.state;
  if (type.startsWith('email:')) return channels.email;
  return channels.lifecycle;
}

export const genericObservability: Observability = {
  emit(event) {
    getChannel(event.type).publish(event);
  },
};

export function subscribe<K extends keyof ChannelEventMap>(
  channelKey: K,
  callback: (event: ChannelEventMap[K]) => void,
): () => void {
  const bucket = listeners[channelKey];
  bucket.add(callback);
  return () => {
    bucket.delete(callback);
  };
}
