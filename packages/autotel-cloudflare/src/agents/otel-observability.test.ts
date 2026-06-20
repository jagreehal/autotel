import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace-base';
import {
  createOtelObservability,
  createOtelObservabilityFromEnv,
  OtelObservability,
} from './otel-observability';
import { channels, genericObservability, subscribe } from './observability';
import type { ObservabilityEvent } from './types';

type CapturingProcessor = SpanProcessor & { spans: ReadableSpan[] };

function createCapturingProcessor(): CapturingProcessor {
  return {
    spans: [],
    forceFlush: vi.fn(async () => undefined),
    onEnd(span) {
      this.spans.push(span);
    },
    onStart: vi.fn(),
    shutdown: vi.fn(async () => undefined),
  };
}

function createObservabilityEvent<T extends ObservabilityEvent['type']>(
  type: T,
  payload: Extract<ObservabilityEvent, { type: T }>['payload'],
  extra: Partial<Extract<ObservabilityEvent, { type: T }>> = {},
): Extract<ObservabilityEvent, { type: T }> {
  return {
    type,
    payload,
    timestamp: Date.now(),
    ...extra,
  } as Extract<ObservabilityEvent, { type: T }>;
}

describe('OtelObservability', () => {
  const processor = createCapturingProcessor();

  beforeEach(() => {
    vi.clearAllMocks();
    processor.spans.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructors', () => {
    it('creates an OtelObservability instance', () => {
      const obs = createOtelObservability({
        service: { name: 'test-agent' },
        spanProcessors: [processor],
      });

      expect(obs).toBeInstanceOf(OtelObservability);
    });

    it('creates an instance from OTEL_* env vars', () => {
      const obs = createOtelObservabilityFromEnv({
        OTEL_SERVICE_NAME: 'my-agent',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example/v1/traces',
        OTEL_EXPORTER_OTLP_HEADERS: 'x-api-key=test,key2=value2',
      });

      expect(obs).toBeInstanceOf(OtelObservability);
    });
  });

  describe('emit', () => {
    it('records rpc spans with agent metadata', () => {
      const obs = createOtelObservability({
        service: { name: 'test-agent' },
        spanProcessors: [processor],
      });

      obs.emit(
        createObservabilityEvent(
          'rpc',
          { method: 'doSomething', streaming: true },
          {
            id: 'rpc-1',
            agent: 'TaskAgent',
            name: 'agent-instance-1',
            displayMessage: 'RPC doSomething',
          },
        ),
      );

      expect(processor.spans).toHaveLength(1);
      expect(processor.spans[0]?.name).toBe('agent.rpc doSomething');
      expect(processor.spans[0]?.attributes).toMatchObject({
        'agent.event.type': 'rpc',
        'agent.event.id': 'rpc-1',
        'agent.class': 'TaskAgent',
        'agent.instance.name': 'agent-instance-1',
        'gen_ai.agent.name': 'TaskAgent',
        'agent.rpc.method': 'doSomething',
        'agent.rpc.streaming': true,
      });
    });

    it('records chat recovery events from the full agent event surface', () => {
      const obs = createOtelObservability({
        service: { name: 'test-agent' },
        spanProcessors: [processor],
      });

      obs.emit(
        createObservabilityEvent('chat:recovery:detected', {
          incidentId: 'inc-1',
          requestId: 'req-1',
          attempt: 2,
          maxAttempts: 5,
          recoveryKind: 'retry',
        }),
      );

      expect(processor.spans).toHaveLength(1);
      expect(processor.spans[0]?.name).toBe('agent.chat.recovery.detected');
      expect(processor.spans[0]?.attributes).toMatchObject({
        'agent.event.type': 'chat:recovery:detected',
        'agent.payload.incidentId': 'inc-1',
        'agent.payload.requestId': 'req-1',
        'agent.payload.attempt': 2,
        'agent.payload.maxAttempts': 5,
        'agent.payload.recoveryKind': 'retry',
      });
    });

    it('marks error spans when the event signals failure', () => {
      const obs = createOtelObservability({
        service: { name: 'test-agent' },
        spanProcessors: [processor],
      });

      obs.emit(
        createObservabilityEvent('rpc:error', {
          method: 'doSomething',
          error: 'boom',
        }),
      );

      expect(processor.spans).toHaveLength(1);
      expect(processor.spans[0]?.status.code).toBe(2);
      expect(processor.spans[0]?.status.message).toBe('boom');
      expect(processor.spans[0]?.attributes).toMatchObject({
        error: true,
        'exception.message': 'boom',
      });
    });

    it('records MCP close events from the reference event model', () => {
      const obs = createOtelObservability({
        service: { name: 'test-agent' },
        spanProcessors: [processor],
      });

      obs.emit(
        createObservabilityEvent('mcp:client:close', {
          url: 'https://mcp.example',
          transport: 'http',
          state: 'closed',
          phase: 'client-close',
        }),
      );

      expect(processor.spans).toHaveLength(1);
      expect(processor.spans[0]?.name).toBe('mcp.client.close https://mcp.example');
      expect(processor.spans[0]?.attributes).toMatchObject({
        'agent.mcp.url': 'https://mcp.example',
        'agent.mcp.transport': 'http',
        'agent.mcp.state': 'closed',
        'agent.payload.phase': 'client-close',
      });
    });

    it('allows noisy categories to be disabled', () => {
      const obs = createOtelObservability({
        service: { name: 'test-agent' },
        spanProcessors: [processor],
        agents: {
          traceStateUpdates: false,
        },
      });

      obs.emit(createObservabilityEvent('state:update', {}));

      expect(processor.spans).toHaveLength(0);
    });

    it('uses custom formatters and attribute extractors', () => {
      const spanNameFormatter = vi.fn(() => 'custom.span');
      const attributeExtractor = vi.fn(() => ({
        'custom.attr': 'value',
      }));

      const obs = createOtelObservability({
        service: { name: 'test-agent' },
        spanProcessors: [processor],
        agents: {
          spanNameFormatter,
          attributeExtractor,
        },
      });

      const event = createObservabilityEvent('workflow:approved', {
        workflowId: 'wf-1',
        reason: 'approved',
      });

      obs.emit(event);

      expect(spanNameFormatter).toHaveBeenCalledWith(event);
      expect(attributeExtractor).toHaveBeenCalledWith(event);
      expect(processor.spans[0]?.name).toBe('custom.span');
      expect(processor.spans[0]?.attributes['custom.attr']).toBe('value');
    });

    it('uses waitUntil when an execution context is provided', () => {
      const obs = createOtelObservability({
        service: { name: 'test-agent' },
        spanProcessors: [processor],
      });
      const waitUntil = vi.fn();

      obs.emit(
        createObservabilityEvent('queue:create', {
          callback: 'process',
          id: 'queue-1',
        }),
        { waitUntil } as unknown as ExecutionContext,
      );

      expect(waitUntil).toHaveBeenCalledTimes(1);
    });

    it('records human approval via recordHumanApproval on tool:approval', () => {
      const obs = createOtelObservability({
        service: { name: 'test-agent' },
        spanProcessors: [processor],
      });

      obs.emit(
        createObservabilityEvent('tool:approval', {
          toolCallId: 'tc-42',
          approved: true,
        }),
      );

      expect(processor.spans).toHaveLength(1);
      expect(processor.spans[0]?.attributes).toMatchObject({
        'agent.consent.required': true,
        'agent.consent.outcome': 'approved',
        'tool.call.id': 'tc-42',
      });
    });
  });

  describe('generic observability channels', () => {
    it('routes events through typed subscriptions', () => {
      const callback = vi.fn();
      const unsubscribe = subscribe('rpc', callback);
      const event = createObservabilityEvent('rpc', { method: 'lookup' });

      genericObservability.emit(event);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(event);

      unsubscribe();
      genericObservability.emit(event);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('publishes directly on exported channels', () => {
      const callback = vi.fn();
      const unsubscribe = subscribe('mcp', callback);
      const event = createObservabilityEvent('mcp:client:preconnect', {
        serverId: 'server-1',
      });

      channels.mcp.publish(event);

      expect(callback).toHaveBeenCalledWith(event);
      unsubscribe();
    });
  });
});
