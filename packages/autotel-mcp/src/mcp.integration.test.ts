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

    expect(DEFAULT_CONFIG.captureArgs).toBe(true);
    expect(DEFAULT_CONFIG.captureResults).toBe(false);
    expect(DEFAULT_CONFIG.captureErrors).toBe(true);
  });
});
