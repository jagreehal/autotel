import { describe, it, expect, beforeEach } from 'vitest';
import { BaggageSpanProcessor } from './baggage-span-processor';
import { context, propagation, trace } from '@opentelemetry/api';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';

// Set up context manager globally
const contextManager = new AsyncLocalStorageContextManager();
contextManager.enable();
context.setGlobalContextManager(contextManager);

describe('BaggageSpanProcessor', () => {
  beforeEach(() => {
    // Set up context manager to ensure context propagation works
    trace.setGlobalTracerProvider(undefined as any);
  });

  it('should copy baggage entries to span attributes with default prefix', async () => {
    const exporter = new InMemorySpanExporter();
    const baggageProcessor = new BaggageSpanProcessor();
    const provider = new BasicTracerProvider({
      spanProcessors: [baggageProcessor, new SimpleSpanProcessor(exporter)],
    });

    // Set as global provider
    trace.setGlobalTracerProvider(provider);

    const tracer = provider.getTracer('test');

    // Set baggage
    const activeContext = context.active();
    let baggage = propagation.createBaggage();
    baggage = baggage.setEntry('tenant.id', { value: 'tenant-123' });
    baggage = baggage.setEntry('user.id', { value: 'user-456' });
    const contextWithBaggage = propagation.setBaggage(activeContext, baggage);

    // Create span within baggage context
    await new Promise<void>((resolve) => {
      context.with(contextWithBaggage, () => {
        tracer.startActiveSpan('test-span', (span) => {
          span.end();
          resolve();
        });
      });
    });

    // Flush to ensure spans are exported
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.attributes['baggage.tenant.id']).toBe('tenant-123');
    expect(spans[0]!.attributes['baggage.user.id']).toBe('user-456');
  });

  it('should use custom prefix when provided', async () => {
    const exporter = new InMemorySpanExporter();
    const baggageProcessor = new BaggageSpanProcessor({ prefix: 'ctx.' });
    const provider = new BasicTracerProvider({
      spanProcessors: [baggageProcessor, new SimpleSpanProcessor(exporter)],
    });

    // Set as global provider
    trace.setGlobalTracerProvider(provider);

    const tracer = provider.getTracer('test');

    // Set baggage
    const activeContext = context.active();
    let baggage = propagation.createBaggage();
    baggage = baggage.setEntry('tenant.id', { value: 'tenant-123' });
    const contextWithBaggage = propagation.setBaggage(activeContext, baggage);

    // Create span within baggage context
    await new Promise<void>((resolve) => {
      context.with(contextWithBaggage, () => {
        tracer.startActiveSpan('test-span', (span) => {
          span.end();
          resolve();
        });
      });
    });

    // Flush to ensure spans are exported
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.attributes['ctx.tenant.id']).toBe('tenant-123');
  });

  it('should use no prefix when empty string provided', async () => {
    const exporter = new InMemorySpanExporter();
    const baggageProcessor = new BaggageSpanProcessor({ prefix: '' });
    const provider = new BasicTracerProvider({
      spanProcessors: [baggageProcessor, new SimpleSpanProcessor(exporter)],
    });

    // Set as global provider
    trace.setGlobalTracerProvider(provider);

    const tracer = provider.getTracer('test');

    // Set baggage
    const activeContext = context.active();
    let baggage = propagation.createBaggage();
    baggage = baggage.setEntry('tenant.id', { value: 'tenant-123' });
    const contextWithBaggage = propagation.setBaggage(activeContext, baggage);

    // Create span within baggage context
    await new Promise<void>((resolve) => {
      context.with(contextWithBaggage, () => {
        tracer.startActiveSpan('test-span', (span) => {
          span.end();
          resolve();
        });
      });
    });

    // Flush to ensure spans are exported
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.attributes['tenant.id']).toBe('tenant-123');
  });

  it('should handle spans with no baggage gracefully', async () => {
    const exporter = new InMemorySpanExporter();
    const baggageProcessor = new BaggageSpanProcessor();
    const provider = new BasicTracerProvider({
      spanProcessors: [baggageProcessor, new SimpleSpanProcessor(exporter)],
    });

    // Set as global provider
    trace.setGlobalTracerProvider(provider);

    const tracer = provider.getTracer('test');

    // Create span without baggage
    await new Promise<void>((resolve) => {
      tracer.startActiveSpan('test-span', (span) => {
        span.end();
        resolve();
      });
    });

    // Flush to ensure spans are exported
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    // Should have no baggage attributes
    expect(
      Object.keys(spans[0]!.attributes).filter((k) => k.startsWith('baggage.')),
    ).toHaveLength(0);
  });

  it('should copy multiple baggage entries', async () => {
    const exporter = new InMemorySpanExporter();
    const baggageProcessor = new BaggageSpanProcessor();
    const provider = new BasicTracerProvider({
      spanProcessors: [baggageProcessor, new SimpleSpanProcessor(exporter)],
    });

    // Set as global provider
    trace.setGlobalTracerProvider(provider);

    const tracer = provider.getTracer('test');

    // Set multiple baggage entries
    const activeContext = context.active();
    let baggage = propagation.createBaggage();
    baggage = baggage.setEntry('key1', { value: 'value1' });
    baggage = baggage.setEntry('key2', { value: 'value2' });
    baggage = baggage.setEntry('key3', { value: 'value3' });
    const contextWithBaggage = propagation.setBaggage(activeContext, baggage);

    // Create span within baggage context
    await new Promise<void>((resolve) => {
      context.with(contextWithBaggage, () => {
        tracer.startActiveSpan('test-span', (span) => {
          span.end();
          resolve();
        });
      });
    });

    // Flush to ensure spans are exported
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.attributes['baggage.key1']).toBe('value1');
    expect(spans[0]!.attributes['baggage.key2']).toBe('value2');
    expect(spans[0]!.attributes['baggage.key3']).toBe('value3');
  });
});
