import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, resolveConfig } from './types';

describe('DEFAULT_CONFIG', () => {
  it('should have correct default values', () => {
    expect(DEFAULT_CONFIG.captureToolArgs).toBe(false);
    expect(DEFAULT_CONFIG.captureToolResults).toBe(false);
    expect(DEFAULT_CONFIG.captureErrors).toBe(true);
    expect(DEFAULT_CONFIG.enableMetrics).toBe(true);
    expect(DEFAULT_CONFIG.captureDiscoveryOperations).toBe(true);
  });

  it('should not have customAttributes in defaults', () => {
    expect('customAttributes' in DEFAULT_CONFIG).toBe(false);
  });
});

describe('resolveConfig', () => {
  it('should return defaults when no config provided', () => {
    const resolved = resolveConfig();
    expect(resolved.captureToolArgs).toBe(false);
    expect(resolved.captureToolResults).toBe(false);
    expect(resolved.captureErrors).toBe(true);
    expect(resolved.enableMetrics).toBe(true);
    expect(resolved.captureDiscoveryOperations).toBe(true);
    expect(resolved.networkTransport).toBeUndefined();
    expect(resolved.sessionId).toBeUndefined();
  });

  it('should respect new config names', () => {
    const resolved = resolveConfig({
      captureToolArgs: true,
      captureToolResults: true,
      networkTransport: 'pipe',
      sessionId: 'test-session',
    });
    expect(resolved.captureToolArgs).toBe(true);
    expect(resolved.captureToolResults).toBe(true);
    expect(resolved.networkTransport).toBe('pipe');
    expect(resolved.sessionId).toBe('test-session');
  });

  it('should support deprecated captureArgs alias', () => {
    const resolved = resolveConfig({ captureArgs: true });
    expect(resolved.captureToolArgs).toBe(true);
  });

  it('should support deprecated captureResults alias', () => {
    const resolved = resolveConfig({ captureResults: true });
    expect(resolved.captureToolResults).toBe(true);
  });

  it('should prefer new names over deprecated aliases', () => {
    const resolved = resolveConfig({
      captureToolArgs: false,
      captureArgs: true,
      captureToolResults: false,
      captureResults: true,
    });
    expect(resolved.captureToolArgs).toBe(false);
    expect(resolved.captureToolResults).toBe(false);
  });
});
