import { describe, it, expect } from 'vitest';

describe('workers entry point', () => {
  it('should export all required functions', async () => {
    const workers = await import('./workers');

    expect(workers.init).toBeDefined();
    expect(typeof workers.init).toBe('function');

    // Functional API
    expect(workers.trace).toBeDefined();
    expect(workers.span).toBeDefined();
    expect(workers.withTracing).toBeDefined();
    expect(workers.instrumentFunction).toBeDefined();
    expect(workers.parseError).toBeDefined();
    expect(workers.getExecutionLogger).toBeDefined();

    // Cloudflare-specific wrappers
    expect(workers.instrument).toBeDefined();
    expect(workers.wrapModule).toBeDefined();
    expect(workers.wrapDurableObject).toBeDefined();
    expect(workers.instrumentDO).toBeDefined();
    expect(workers.instrumentWorkflow).toBeDefined();
    expect(workers.instrumentBindings).toBeDefined();

    // Logger helpers
    expect(workers.getRequestLogger).toBeDefined();
    expect(workers.getQueueLogger).toBeDefined();
    expect(workers.getWorkflowLogger).toBeDefined();
    expect(workers.createWorkersLogger).toBeDefined();

    // Global instrumentation
    expect(workers.instrumentGlobalFetch).toBeDefined();
    expect(workers.instrumentGlobalCache).toBeDefined();
  });

  it('should export sampling utilities', async () => {
    const workers = await import('./workers');

    expect(workers.SamplingPresets).toBeDefined();
    expect(workers.createAdaptiveTailSampler).toBeDefined();
    expect(workers.createRandomTailSampler).toBeDefined();
    expect(workers.createErrorOnlyTailSampler).toBeDefined();
    expect(workers.createSlowOnlyTailSampler).toBeDefined();
    expect(workers.createCustomTailSampler).toBeDefined();
    expect(workers.combineTailSamplers).toBeDefined();
  });

  it('should export logger module', async () => {
    const workers = await import('./workers');

    expect(workers.createEdgeLogger).toBeDefined();
    expect(workers.runWithLogLevel).toBeDefined();
    expect(workers.getEdgeTraceContext).toBeDefined();
    expect(workers.getActiveLogLevel).toBeDefined();
  });

  it('should export events module', async () => {
    const workers = await import('./workers');

    expect(workers.createEdgeSubscribers).toBeDefined();
    expect(workers.getEdgeSubscribers).toBeDefined();
    expect(workers.getEventName).toBeDefined();
  });
});
