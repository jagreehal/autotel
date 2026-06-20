/**
 * OpenTelemetry-based Observability implementation for Cloudflare Agents SDK
 *
 * Converts Agent events into OpenTelemetry spans for distributed tracing.
 */

import {
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  WorkerTracer,
  WorkerTracerProvider,
  createInitialiser,
  type ResolvedEdgeConfig,
} from 'autotel-edge';
import type {
  AgentInstrumentationOptions,
  MCPObservabilityEvent,
  Observability,
  ObservabilityEvent,
  ObservabilityExecutionContext,
  OtelObservabilityConfig,
} from './types';

let providerInitialized = false;

type EventCategory =
  | 'state'
  | 'rpc'
  | 'schedule'
  | 'queue'
  | 'submission'
  | 'message'
  | 'chat'
  | 'transcript'
  | 'fiber'
  | 'agentTool'
  | 'lifecycle'
  | 'workflow'
  | 'mcp'
  | 'email';

function initProvider(config: ResolvedEdgeConfig): void {
  if (providerInitialized) return;

  const resource = resourceFromAttributes({
    'service.name': config.service.name,
    'service.version': config.service.version,
    'service.namespace': config.service.namespace,
    'cloud.provider': 'cloudflare',
    'cloud.platform': 'cloudflare.workers',
    'telemetry.sdk.name': 'autotel-cloudflare',
    'telemetry.sdk.language': 'js',
    'agent.framework': 'cloudflare-agents',
  });

  const provider = new WorkerTracerProvider(config.spanProcessors, resource);
  provider.register();

  const tracer = trace.getTracer('autotel-cloudflare/agents') as WorkerTracer;
  tracer.setHeadSampler(config.sampling.headSampler);

  providerInitialized = true;
}

function classifyEvent(type: ObservabilityEvent['type']): EventCategory {
  if (type.startsWith('mcp:')) return 'mcp';
  if (type.startsWith('workflow:')) return 'workflow';
  if (type.startsWith('fiber:')) return 'fiber';
  if (type.startsWith('agent_tool:')) return 'agentTool';
  if (type.startsWith('chat:transcript:')) return 'transcript';
  if (type.startsWith('chat:')) return 'chat';
  if (type.startsWith('submission:')) return 'submission';
  if (type.startsWith('queue:')) return 'queue';
  if (type.startsWith('schedule:')) return 'schedule';
  if (
    type.startsWith('message:') ||
    type.startsWith('tool:') ||
    type === 'rpc:error'
  ) {
    return 'message';
  }
  if (type === 'rpc') return 'rpc';
  if (type.startsWith('state:')) return 'state';
  if (type.startsWith('email:')) return 'email';
  if (type === 'connect' || type === 'disconnect' || type === 'destroy') {
    return 'lifecycle';
  }
  return 'message';
}

function shouldTraceEvent(
  event: ObservabilityEvent,
  options: AgentInstrumentationOptions,
): boolean {
  const opts: Required<
    Pick<
      AgentInstrumentationOptions,
      | 'traceRpc'
      | 'traceSchedule'
      | 'traceQueue'
      | 'traceSubmissions'
      | 'traceMcp'
      | 'traceStateUpdates'
      | 'traceMessages'
      | 'traceLifecycle'
      | 'traceChat'
      | 'traceTranscripts'
      | 'traceFibers'
      | 'traceToolRecovery'
      | 'traceWorkflow'
      | 'traceEmail'
    >
  > = {
    traceRpc: true,
    traceSchedule: true,
    traceQueue: true,
    traceSubmissions: true,
    traceMcp: true,
    traceStateUpdates: false,
    traceMessages: true,
    traceLifecycle: true,
    traceChat: true,
    traceTranscripts: true,
    traceFibers: true,
    traceToolRecovery: true,
    traceWorkflow: true,
    traceEmail: true,
  };
  const merged = { ...opts, ...options };

  switch (classifyEvent(event.type)) {
    case 'rpc': {
      return merged.traceRpc;
    }
    case 'schedule': {
      return merged.traceSchedule;
    }
    case 'queue': {
      return merged.traceQueue;
    }
    case 'submission': {
      return merged.traceSubmissions;
    }
    case 'mcp': {
      return merged.traceMcp;
    }
    case 'state': {
      return merged.traceStateUpdates;
    }
    case 'message': {
      return merged.traceMessages;
    }
    case 'lifecycle': {
      return merged.traceLifecycle;
    }
    case 'chat': {
      return merged.traceChat;
    }
    case 'transcript': {
      return merged.traceTranscripts;
    }
    case 'fiber': {
      return merged.traceFibers;
    }
    case 'agentTool': {
      return merged.traceToolRecovery;
    }
    case 'workflow': {
      return merged.traceWorkflow;
    }
    case 'email': {
      return merged.traceEmail;
    }
  }
}

function formatTypeSegment(value: string): string {
  return value.replaceAll(/[:_]/g, '.');
}

function getPayloadName(
  payload: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function getDefaultSpanName(event: ObservabilityEvent): string {
  const payload = event.payload;

  switch (event.type) {
    case 'rpc':
    case 'rpc:error': {
      return `agent.rpc ${(payload as { method: string }).method}`;
    }
    case 'schedule:create':
    case 'schedule:execute':
    case 'schedule:cancel':
    case 'schedule:retry':
    case 'schedule:error':
    case 'schedule:duplicate_warning': {
      return `agent.${formatTypeSegment(event.type)} ${getPayloadName(payload, 'callback') ?? 'unknown'}`;
    }
    case 'queue:create':
    case 'queue:retry':
    case 'queue:error': {
      return `agent.${formatTypeSegment(event.type)} ${getPayloadName(payload, 'callback') ?? 'unknown'}`;
    }
    case 'submission:create':
    case 'submission:status':
    case 'submission:error': {
      return `agent.${formatTypeSegment(event.type)} ${getPayloadName(payload, 'submissionId') ?? 'unknown'}`;
    }
    case 'connect':
    case 'disconnect': {
      return `agent.${event.type} ${getPayloadName(payload, 'connectionId') ?? 'unknown'}`;
    }
    case 'mcp:client:preconnect': {
      return `mcp.client.preconnect ${getPayloadName(payload, 'serverId') ?? 'unknown'}`;
    }
    case 'mcp:client:authorize': {
      return `mcp.client.authorize ${getPayloadName(payload, 'serverId') ?? 'unknown'}`;
    }
    case 'mcp:client:connect':
    case 'mcp:client:discover':
    case 'mcp:client:close': {
      return `mcp.client.${formatTypeSegment(event.type).split('.').slice(-1)[0]} ${
        getPayloadName(payload, 'url', 'capability', 'state') ?? 'unknown'
      }`;
    }
    case 'workflow:start':
    case 'workflow:event':
    case 'workflow:approved':
    case 'workflow:rejected':
    case 'workflow:terminated':
    case 'workflow:paused':
    case 'workflow:resumed':
    case 'workflow:restarted': {
      return `agent.${formatTypeSegment(event.type)} ${
        getPayloadName(payload, 'workflowName', 'workflowId', 'eventType') ?? 'unknown'
      }`;
    }
    case 'email:receive':
    case 'email:reply':
    case 'email:send': {
      return `agent.${formatTypeSegment(event.type)} ${getPayloadName(payload, 'subject') ?? 'message'}`;
    }
    case 'destroy': {
      return 'agent.destroy';
    }
    default: {
      return `agent.${formatTypeSegment(event.type)}`;
    }
  }
}

function isPrimitiveAttributeValue(
  value: unknown,
): value is string | number | boolean | string[] | number[] | boolean[] {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true;
  }

  if (!Array.isArray(value)) {
    return false;
  }

  return value.every(
    (entry) =>
      typeof entry === 'string' ||
      typeof entry === 'number' ||
      typeof entry === 'boolean',
  );
}

function setIfPresent(
  attrs: Attributes,
  key: string,
  value: unknown,
): void {
  if (value === undefined || value === null) return;
  if (isPrimitiveAttributeValue(value)) {
    attrs[key] = value;
  }
}

function getDefaultAttributes(event: ObservabilityEvent): Attributes {
  const attrs: Attributes = {
    'agent.event.type': event.type,
  };

  setIfPresent(attrs, 'agent.event.id', event.id);
  setIfPresent(attrs, 'agent.display_message', event.displayMessage);
  setIfPresent(attrs, 'agent.class', event.agent);
  setIfPresent(attrs, 'agent.instance.name', event.name);
  setIfPresent(attrs, 'gen_ai.agent.name', event.agent);

  switch (event.type) {
    case 'rpc': {
      attrs['agent.rpc.method'] = event.payload.method;
      setIfPresent(attrs, 'agent.rpc.streaming', event.payload.streaming);
      break;
    }
    case 'rpc:error': {
      attrs['agent.rpc.method'] = event.payload.method;
      break;
    }
    case 'schedule:create':
    case 'schedule:execute':
    case 'schedule:cancel':
    case 'schedule:retry':
    case 'schedule:error':
    case 'queue:create':
    case 'queue:retry':
    case 'queue:error': {
      setIfPresent(attrs, 'agent.schedule.callback', event.payload.callback);
      setIfPresent(attrs, 'agent.schedule.id', event.payload.id);
      break;
    }
    case 'schedule:duplicate_warning': {
      setIfPresent(attrs, 'agent.schedule.callback', event.payload.callback);
      break;
    }
    case 'connect':
    case 'disconnect': {
      setIfPresent(attrs, 'agent.connection.id', event.payload.connectionId);
      break;
    }
    case 'mcp:client:preconnect': {
      setIfPresent(attrs, 'agent.mcp.server_id', event.payload.serverId);
      break;
    }
    case 'mcp:client:connect':
    case 'mcp:client:close': {
      setIfPresent(attrs, 'agent.mcp.url', event.payload.url);
      setIfPresent(attrs, 'agent.mcp.transport', event.payload.transport);
      setIfPresent(attrs, 'agent.mcp.state', event.payload.state);
      break;
    }
    case 'mcp:client:authorize': {
      setIfPresent(attrs, 'agent.mcp.server_id', event.payload.serverId);
      setIfPresent(attrs, 'agent.mcp.auth_url', event.payload.authUrl);
      setIfPresent(attrs, 'agent.mcp.client_id', event.payload.clientId);
      break;
    }
    case 'mcp:client:discover': {
      setIfPresent(attrs, 'agent.mcp.url', event.payload.url);
      setIfPresent(attrs, 'agent.mcp.state', event.payload.state);
      setIfPresent(attrs, 'agent.mcp.capability', event.payload.capability);
      break;
    }
  }

  for (const [key, value] of Object.entries(event.payload)) {
    setIfPresent(attrs, `agent.payload.${key}`, value);
  }

  return attrs;
}

function getSpanKind(event: ObservabilityEvent): SpanKind {
  switch (classifyEvent(event.type)) {
    case 'rpc':
    case 'lifecycle':
    case 'email': {
      return SpanKind.SERVER;
    }
    case 'mcp': {
      return SpanKind.CLIENT;
    }
    case 'schedule':
    case 'queue': {
      return SpanKind.CONSUMER;
    }
    default: {
      return SpanKind.INTERNAL;
    }
  }
}

function inferErrorMessage(event: ObservabilityEvent): string | undefined {
  const payload = event.payload as Record<string, unknown>;
  const direct = payload.error;
  if (typeof direct === 'string' && direct.length > 0) {
    return direct;
  }

  if (event.type === 'workflow:rejected') {
    const reason = payload.reason;
    if (typeof reason === 'string' && reason.length > 0) {
      return reason;
    }
    return 'workflow rejected';
  }

  if (event.type.endsWith(':failed') || event.type.endsWith(':error')) {
    return event.type;
  }

  return undefined;
}

function isErrorEvent(event: ObservabilityEvent): boolean {
  if (event.type === 'workflow:rejected') return true;
  if (event.type.endsWith(':error') || event.type.endsWith(':failed')) return true;

  if ('error' in event.payload) {
    return typeof (event.payload as Record<string, unknown>).error === 'string';
  }

  return false;
}

function applyEventStatus(span: Span, event: ObservabilityEvent): void {
  if (!isErrorEvent(event)) {
    span.setStatus({ code: SpanStatusCode.OK });
    return;
  }

  const message = inferErrorMessage(event);
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message,
  });
  span.setAttribute('error', true);

  if (message) {
    span.setAttribute('exception.message', message);
  }
}

async function exportSpans(
  traceId: string,
  ctx?: ObservabilityExecutionContext,
): Promise<void> {
  const tracer = trace.getTracer('autotel-cloudflare/agents');
  if (tracer instanceof WorkerTracer) {
    try {
      const scheduler = ctx && 'scheduler' in ctx
        ? (ctx.scheduler as { wait?: (ms: number) => Promise<void> } | undefined)
        : undefined;
      if (scheduler?.wait) {
        await scheduler.wait(1);
      }
      await tracer.forceFlush(traceId);
    } catch (error) {
      console.error('[autotel-cloudflare/agents] Failed to export spans:', error);
    }
  }
}

/**
 * OpenTelemetry-based Observability implementation
 *
 * Implements the Agents SDK Observability interface and converts
 * events into OpenTelemetry spans.
 */
export class OtelObservability implements Observability {
  private readonly config: ResolvedEdgeConfig;
  private readonly options: AgentInstrumentationOptions;
  private initialized = false;

  constructor(config: OtelObservabilityConfig) {
    const initialiser = createInitialiser(config);
    this.config = initialiser({}, undefined);
    this.options = config.agents ?? {};
  }

  private initialize(): void {
    if (this.initialized) return;
    initProvider(this.config);
    this.initialized = true;
  }

  emit(event: ObservabilityEvent, ctx?: ObservabilityExecutionContext): void {
    this.initialize();

    if (!shouldTraceEvent(event, this.options)) {
      return;
    }

    const tracer = trace.getTracer('autotel-cloudflare/agents');
    const spanName = this.options.spanNameFormatter
      ? this.options.spanNameFormatter(event)
      : getDefaultSpanName(event);
    const defaultAttrs = getDefaultAttributes(event);
    const customAttrs = this.options.attributeExtractor
      ? this.options.attributeExtractor(event)
      : {};
    const span = tracer.startSpan(spanName, {
      kind: getSpanKind(event),
      attributes: { ...defaultAttrs, ...customAttrs },
      startTime: event.timestamp,
    });

    applyEventStatus(span, event);
    span.end(event.timestamp + 1);

    const traceId = span.spanContext().traceId;
    if (ctx && 'waitUntil' in ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(exportSpans(traceId, ctx));
      return;
    }

    void exportSpans(traceId, ctx);
  }
}

export function createOtelObservability(
  config: OtelObservabilityConfig,
): OtelObservability {
  return new OtelObservability(config);
}

export function createOtelObservabilityFromEnv(
  env: Record<string, unknown>,
  options?: AgentInstrumentationOptions,
): OtelObservability {
  const endpoint = (env.OTEL_EXPORTER_OTLP_ENDPOINT as string) || undefined;
  const serviceName = (env.OTEL_SERVICE_NAME as string) || 'cloudflare-agent';

  let headers: Record<string, string> | undefined;
  const headersStr = env.OTEL_EXPORTER_OTLP_HEADERS as string;
  if (headersStr) {
    headers = {};
    for (const pair of headersStr.split(',')) {
      const [key, value] = pair.split('=');
      if (key && value) {
        headers[key.trim()] = value.trim();
      }
    }
  }

  return createOtelObservability({
    service: { name: serviceName },
    exporter: { url: endpoint || 'http://localhost:4318/v1/traces', headers },
    agents: options,
  });
}

export type { MCPObservabilityEvent };
