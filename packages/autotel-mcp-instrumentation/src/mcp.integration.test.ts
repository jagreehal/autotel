import { describe, it, expect } from 'vitest';
import { trace as otelTrace, context } from '@opentelemetry/api';

describe('Integration: MCP Distributed Tracing', () => {
  it('should inject W3C trace context into _meta field', async () => {
    const { injectOtelContextToMeta } = await import('./context.js');

    // Create a span
    const tracer = otelTrace.getTracer('test');
    const span = tracer.startSpan('test-operation');

    let traceparent: string | undefined;

    await context.with(otelTrace.setSpan(context.active(), span), async () => {
      const meta = injectOtelContextToMeta();
      traceparent = meta.traceparent;
    });

    span.end();

    expect(traceparent).toBeDefined();
    expect(traceparent).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-[0-1]{2}$/);
  });

  it('should extract W3C trace context from _meta field', async () => {
    const { extractOtelContextFromMeta, injectOtelContextToMeta } =
      await import('./context.js');

    const tracer = otelTrace.getTracer('test');
    const parentSpan = tracer.startSpan('parent');

    let childTraceId: string | undefined;
    let parentTraceId: string | undefined;

    await context.with(
      otelTrace.setSpan(context.active(), parentSpan),
      async () => {
        parentTraceId = parentSpan.spanContext().traceId;

        // Inject context
        const meta = injectOtelContextToMeta();

        // Extract context (simulating server-side)
        const extracted = extractOtelContextFromMeta(meta);

        // Create child span with extracted context
        await context.with(extracted, async () => {
          const childSpan = tracer.startSpan('child');
          childTraceId = childSpan.spanContext().traceId;
          childSpan.end();
        });

        parentSpan.end();
      },
    );

    // Verify trace IDs match (distributed trace)
    expect(childTraceId).toBe(parentTraceId);
  });

  it('should handle missing _meta gracefully', async () => {
    const { extractOtelContextFromMeta } = await import('./context.js');

    // Should return active context when _meta is undefined
    const ctx1 = extractOtelContextFromMeta();
    expect(ctx1).toBe(context.active());

    // Should return active context when _meta is empty
    const ctx2 = extractOtelContextFromMeta({});
    expect(ctx2).toBe(context.active());

    // Should return active context when _meta is invalid
    const ctx3 = extractOtelContextFromMeta({ invalid: 'data' } as any);
    expect(ctx3).toBe(context.active());
  });

  it('should merge config with defaults', async () => {
    const { DEFAULT_CONFIG } = await import('./types.js');

    expect(DEFAULT_CONFIG.captureToolArgs).toBe(false);
    expect(DEFAULT_CONFIG.captureToolResults).toBe(false);
    expect(DEFAULT_CONFIG.captureErrors).toBe(true);
    expect(DEFAULT_CONFIG.enableMetrics).toBe(true);
    expect(DEFAULT_CONFIG.captureDiscoveryOperations).toBe(true);
  });

  it('should export semantic convention constants', async () => {
    const { MCP_SEMCONV, MCP_METHODS, MCP_METRICS } =
      await import('./semantic-conventions.js');

    // Verify key attribute names
    expect(MCP_SEMCONV.METHOD_NAME).toBe('mcp.method.name');
    expect(MCP_SEMCONV.TOOL_NAME).toBe('gen_ai.tool.name');
    expect(MCP_SEMCONV.ERROR_TYPE).toBe('error.type');
    expect(MCP_SEMCONV.OPERATION_NAME).toBe('gen_ai.operation.name');
    expect(MCP_SEMCONV.NETWORK_TRANSPORT).toBe('network.transport');
    expect(MCP_SEMCONV.SESSION_ID).toBe('mcp.session.id');

    // Verify method names
    expect(MCP_METHODS.TOOLS_CALL).toBe('tools/call');
    expect(MCP_METHODS.TOOLS_LIST).toBe('tools/list');
    expect(MCP_METHODS.RESOURCES_READ).toBe('resources/read');
    expect(MCP_METHODS.RESOURCES_LIST).toBe('resources/list');
    expect(MCP_METHODS.PROMPTS_GET).toBe('prompts/get');
    expect(MCP_METHODS.PROMPTS_LIST).toBe('prompts/list');
    expect(MCP_METHODS.PING).toBe('ping');

    // Verify metric names
    expect(MCP_METRICS.CLIENT_OPERATION_DURATION).toBe(
      'mcp.client.operation.duration',
    );
    expect(MCP_METRICS.SERVER_OPERATION_DURATION).toBe(
      'mcp.server.operation.duration',
    );
  });
});
