/**
 * OpenTelemetry-based Observability implementation for Cloudflare Agents SDK
 *
 * Converts Agent events into OpenTelemetry spans for distributed tracing.
 *
 * @example
 * ```typescript
 * import { Agent } from 'agents'
 * import { createOtelObservability } from 'autotel-cloudflare/agents'
 *
 * class MyAgent extends Agent<Env> {
 *   observability = createOtelObservability({
 *     service: { name: 'my-agent' },
 *     exporter: { url: env.OTLP_ENDPOINT }
 *   })
 *
 *   @callable()
 *   async doSomething() {
 *     // This RPC call will be automatically traced
 *     return 'done'
 *   }
 * }
 * ```
 */

import {
  trace,
  SpanStatusCode,
  SpanKind,
  type Span,
  type Attributes,
} from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  createInitialiser,
  WorkerTracerProvider,
  WorkerTracer,
  type ResolvedEdgeConfig,
} from 'autotel-edge';
import type {
  Observability,
  ObservabilityEvent,
  OtelObservabilityConfig,
  AgentInstrumentationOptions,
} from './types';

/**
 * Map of active spans keyed by event ID
 * Used to correlate start/end events
 */
const activeSpans = new Map<string, Span>();

/**
 * Whether the provider has been initialized
 */
let providerInitialized = false;

/**
 * Initialize the tracer provider for Agents
 */
function initProvider(config: ResolvedEdgeConfig): void {
  if (providerInitialized) return;

  // Create resource with agent-specific attributes
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

  // Create and register provider
  const provider = new WorkerTracerProvider(config.spanProcessors, resource);
  provider.register();

  // Set head sampler on tracer
  const tracer = trace.getTracer('autotel-cloudflare/agents') as WorkerTracer;
  tracer.setHeadSampler(config.sampling.headSampler);

  providerInitialized = true;
}

/**
 * Get default span name for an event
 */
function getDefaultSpanName(event: ObservabilityEvent): string {
  switch (event.type) {
    case 'rpc': {
      return `agent.rpc ${event.payload.method}`;
    }
    case 'schedule:create': {
      return `agent.schedule.create ${event.payload.callback}`;
    }
    case 'schedule:execute': {
      return `agent.schedule.execute ${event.payload.callback}`;
    }
    case 'schedule:cancel': {
      return `agent.schedule.cancel ${event.payload.callback}`;
    }
    case 'connect': {
      return `agent.connect`;
    }
    case 'destroy': {
      return `agent.destroy`;
    }
    case 'state:update': {
      return `agent.state.update`;
    }
    case 'message:request': {
      return `agent.message.request`;
    }
    case 'message:response': {
      return `agent.message.response`;
    }
    case 'message:clear': {
      return `agent.message.clear`;
    }
    case 'mcp:client:preconnect': {
      return `mcp.preconnect ${event.payload.serverId}`;
    }
    case 'mcp:client:connect': {
      return `mcp.connect ${event.payload.url}`;
    }
    case 'mcp:client:authorize': {
      return `mcp.authorize ${event.payload.serverId}`;
    }
    case 'mcp:client:discover': {
      return `mcp.discover`;
    }
    default: {
      return `agent.${(event as ObservabilityEvent).type}`;
    }
  }
}

/**
 * Get default attributes for an event
 */
function getDefaultAttributes(event: ObservabilityEvent): Attributes {
  const attrs: Attributes = {
    'agent.event.type': event.type,
    'agent.event.id': event.id,
  };

  // Add type-specific attributes
  switch (event.type) {
    case 'rpc': {
      attrs['agent.rpc.method'] = event.payload.method;
      if (event.payload.streaming !== undefined) {
        attrs['agent.rpc.streaming'] = event.payload.streaming;
      }
      break;
    }

    case 'schedule:create':
    case 'schedule:execute':
    case 'schedule:cancel': {
      attrs['agent.schedule.callback'] = event.payload.callback;
      attrs['agent.schedule.id'] = event.payload.id;
      break;
    }

    case 'connect': {
      attrs['agent.connection.id'] = event.payload.connectionId;
      break;
    }

    case 'mcp:client:preconnect': {
      attrs['agent.mcp.server_id'] = event.payload.serverId;
      break;
    }

    case 'mcp:client:connect': {
      attrs['agent.mcp.url'] = event.payload.url;
      attrs['agent.mcp.transport'] = event.payload.transport;
      attrs['agent.mcp.state'] = event.payload.state;
      if (event.payload.error) {
        attrs['agent.mcp.error'] = event.payload.error;
      }
      break;
    }

    case 'mcp:client:authorize': {
      attrs['agent.mcp.server_id'] = event.payload.serverId;
      attrs['agent.mcp.auth_url'] = event.payload.authUrl;
      if (event.payload.clientId) {
        attrs['agent.mcp.client_id'] = event.payload.clientId;
      }
      break;
    }
  }

  // Add any additional payload properties as attributes
  for (const [key, value] of Object.entries(event.payload)) {
    if (
      attrs[`agent.${key}`] === undefined &&
      (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    ) {
      attrs[`agent.payload.${key}`] = value;
    }
  }

  return attrs;
}

/**
 * Determine span kind based on event type
 */
function getSpanKind(event: ObservabilityEvent): SpanKind {
  switch (event.type) {
    case 'rpc': {
      return SpanKind.SERVER;
    }
    case 'connect': {
      return SpanKind.SERVER;
    }
    case 'mcp:client:connect':
    case 'mcp:client:preconnect':
    case 'mcp:client:authorize':
    case 'mcp:client:discover': {
      return SpanKind.CLIENT;
    }
    default: {
      return SpanKind.INTERNAL;
    }
  }
}

/**
 * Check if an event type should be traced based on options
 */
function shouldTraceEvent(
  event: ObservabilityEvent,
  options: AgentInstrumentationOptions,
): boolean {
  const defaults: AgentInstrumentationOptions = {
    traceRpc: true,
    traceSchedule: true,
    traceMcp: true,
    traceStateUpdates: false,
    traceMessages: true,
    traceLifecycle: true,
  };

  const opts = { ...defaults, ...options };

  switch (event.type) {
    case 'rpc': {
      return opts.traceRpc ?? true;
    }

    case 'schedule:create':
    case 'schedule:execute':
    case 'schedule:cancel': {
      return opts.traceSchedule ?? true;
    }

    case 'mcp:client:preconnect':
    case 'mcp:client:connect':
    case 'mcp:client:authorize':
    case 'mcp:client:discover': {
      return opts.traceMcp ?? true;
    }

    case 'state:update': {
      return opts.traceStateUpdates ?? false;
    }

    case 'message:request':
    case 'message:response':
    case 'message:clear': {
      return opts.traceMessages ?? true;
    }

    case 'connect':
    case 'destroy': {
      return opts.traceLifecycle ?? true;
    }

    default: {
      return true;
    }
  }
}

/**
 * Export spans asynchronously
 */
async function exportSpans(
  traceId: string,
  ctx?: DurableObjectState | ExecutionContext,
): Promise<void> {
  const tracer = trace.getTracer('autotel-cloudflare/agents');
  if (tracer instanceof WorkerTracer) {
    try {
      // scheduler is only available on ExecutionContext, not DurableObjectState
      if (ctx && 'scheduler' in ctx) {
        const ctxWithScheduler = ctx as ExecutionContext & { scheduler?: { wait(ms: number): Promise<void> } };
        if (ctxWithScheduler.scheduler) {
          await ctxWithScheduler.scheduler.wait(1);
        }
      }
      await tracer.forceFlush(traceId);
    } catch (error) {
      console.error('[autotel-cloudflare/agents] Failed to export spans:', error);
    }
  }

  // If we have a DurableObject context, use waitUntil for export
  if (ctx && 'waitUntil' in ctx) {
    // Already exported above, but could defer more work here
  }
}

/**
 * OpenTelemetry-based Observability implementation
 *
 * Implements the Agents SDK Observability interface and converts
 * events into OpenTelemetry spans.
 */
export class OtelObservability implements Observability {
  private config: ResolvedEdgeConfig;
  private options: AgentInstrumentationOptions;
  private initialized = false;

  constructor(config: OtelObservabilityConfig) {
    // Use createInitialiser to resolve the config
    const initialiser = createInitialiser(config);
    this.config = initialiser({}, undefined);
    this.options = config.agents ?? {};
  }

  /**
   * Initialize the tracer provider (called lazily on first emit)
   */
  private initialize(): void {
    if (this.initialized) return;
    initProvider(this.config);
    this.initialized = true;
  }

  /**
   * Emit an observability event
   *
   * Converts the event to an OpenTelemetry span based on the event type.
   */
  emit(event: ObservabilityEvent, ctx?: DurableObjectState): void {
    // Initialize provider on first emit
    this.initialize();

    // Check if this event type should be traced
    if (!shouldTraceEvent(event, this.options)) {
      return;
    }

    const tracer = trace.getTracer('autotel-cloudflare/agents');

    // Get span name (custom or default)
    const spanName = this.options.spanNameFormatter
      ? this.options.spanNameFormatter(event)
      : getDefaultSpanName(event);

    // Get attributes (custom + default)
    const defaultAttrs = getDefaultAttributes(event);
    const customAttrs = this.options.attributeExtractor
      ? this.options.attributeExtractor(event)
      : {};
    const attributes = { ...defaultAttrs, ...customAttrs };

    // Determine span kind
    const kind = getSpanKind(event);

    // Create span with event timestamp
    const span = tracer.startSpan(spanName, {
      kind,
      attributes,
      startTime: event.timestamp,
    });

    // For short-lived events, end immediately
    // For events that have duration (like RPC), we would ideally track start/end
    // But the Agents SDK emits single events, so we create point-in-time spans
    span.setStatus({ code: SpanStatusCode.OK });
    span.end(event.timestamp + 1); // End 1ms after start

    // Store span for potential correlation
    activeSpans.set(event.id, span);

    // Schedule span export
    const traceId = span.spanContext().traceId;
    if (ctx && 'waitUntil' in ctx && typeof (ctx as any).waitUntil === 'function') {
      (ctx as any).waitUntil(exportSpans(traceId, ctx));
    } else {
      // In environments without waitUntil, export synchronously-ish
      void exportSpans(traceId, ctx);
    }
  }
}

/**
 * Create an OtelObservability instance
 *
 * @example
 * ```typescript
 * import { Agent } from 'agents'
 * import { createOtelObservability } from 'autotel-cloudflare/agents'
 *
 * class MyAgent extends Agent<Env> {
 *   observability = createOtelObservability({
 *     service: { name: 'my-agent' },
 *     exporter: { url: env.OTLP_ENDPOINT }
 *   })
 * }
 * ```
 */
export function createOtelObservability(config: OtelObservabilityConfig): OtelObservability {
  return new OtelObservability(config);
}

/**
 * Create an OtelObservability instance with environment-based config
 *
 * Use this when you need to access environment variables for configuration.
 *
 * @example
 * ```typescript
 * import { Agent } from 'agents'
 * import { createOtelObservabilityFromEnv } from 'autotel-cloudflare/agents'
 *
 * class MyAgent extends Agent<Env> {
 *   observability?: OtelObservability
 *
 *   constructor(state: DurableObjectState, env: Env) {
 *     super(state, env)
 *     this.observability = createOtelObservabilityFromEnv(env)
 *   }
 * }
 * ```
 */
export function createOtelObservabilityFromEnv(
  env: Record<string, unknown>,
  options?: AgentInstrumentationOptions,
): OtelObservability {
  // Extract standard OTLP env vars
  const endpoint = (env.OTEL_EXPORTER_OTLP_ENDPOINT as string) || undefined;
  const serviceName = (env.OTEL_SERVICE_NAME as string) || 'cloudflare-agent';

  // Parse headers if present
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

  // If no endpoint is configured, use a default localhost endpoint
  // In production, users should set OTEL_EXPORTER_OTLP_ENDPOINT
  const exporterUrl = endpoint || 'http://localhost:4318/v1/traces';

  return createOtelObservability({
    service: { name: serviceName },
    exporter: { url: exporterUrl, headers },
    agents: options,
  });
}
