import { describe, it, expect, afterEach } from 'vitest';
import {
  initInstrumentation,
  shutdownInstrumentation,
} from './instrumentation';
import type { NodeSDK } from '@opentelemetry/sdk-node';

describe('initInstrumentation', () => {
  let sdk: NodeSDK | undefined;

  afterEach(async () => {
    if (sdk) {
      try {
        await shutdownInstrumentation(sdk);
      } catch {
        // Ignore shutdown errors in tests
      }
      sdk = undefined;
    }
  });

  it('should initialize with minimal config', async () => {
    sdk = await initInstrumentation({
      serviceName: 'test-service',
    });

    expect(sdk).toBeDefined();
  });

  it('should initialize with full config', async () => {
    sdk = await initInstrumentation({
      serviceName: 'test-service',
      serviceVersion: '2.0.0',
      deploymentEnvironment: 'test',
      otlpEndpoint: 'http://localhost:4318',
    });

    expect(sdk).toBeDefined();
  });

  it('should support detectResources option', async () => {
    sdk = await initInstrumentation({
      serviceName: 'test-service',
      detectResources: true,
    });

    expect(sdk).toBeDefined();
  });

  it('should return NodeSDK instance', async () => {
    sdk = await initInstrumentation({
      serviceName: 'test-service',
    });

    expect(sdk).toBeDefined();
    expect(typeof sdk.start).toBe('function');
    expect(typeof sdk.shutdown).toBe('function');
  });
});

describe('shutdownInstrumentation', () => {
  it('should shutdown without error', async () => {
    const sdk = await initInstrumentation({
      serviceName: 'test-shutdown',
    });

    await expect(shutdownInstrumentation(sdk)).resolves.not.toThrow();
  });

  it('should handle shutdown with no SDK gracefully', async () => {
    // Should warn but not throw
    await expect(shutdownInstrumentation()).resolves.not.toThrow();
  });

  it('should handle multiple shutdowns gracefully', async () => {
    const sdk = await initInstrumentation({
      serviceName: 'test-multiple-shutdown',
    });

    await shutdownInstrumentation(sdk);

    // Second shutdown should not throw
    await expect(shutdownInstrumentation(sdk)).resolves.not.toThrow();
  });
});

describe('SIGTERM handler', () => {
  it('should not add new handlers on subsequent inits', async () => {
    const sdk1 = await initInstrumentation({
      serviceName: 'test-1',
    });

    const countAfterFirst = process.listenerCount('SIGTERM');

    const sdk2 = await initInstrumentation({
      serviceName: 'test-2',
    });

    const countAfterSecond = process.listenerCount('SIGTERM');

    // Should not add a new handler on second init
    expect(countAfterSecond).toBe(countAfterFirst);

    // Cleanup
    await shutdownInstrumentation(sdk1);
    await shutdownInstrumentation(sdk2);
  });
});
