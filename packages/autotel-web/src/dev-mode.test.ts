// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDevelopment } from './dev-mode';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isDevelopment', () => {
  it('reads a substituted NODE_ENV first', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(isDevelopment()).toBe(false);
    vi.stubEnv('NODE_ENV', 'development');
    expect(isDevelopment()).toBe(true);
  });

  it('falls back to a local hostname when NODE_ENV is absent', () => {
    vi.stubEnv('NODE_ENV', '');
    // jsdom serves the test page from localhost.
    expect(globalThis.location.hostname).toBe('localhost');
    expect(isDevelopment()).toBe(true);
  });
});

describe('isDevelopment without process', () => {
  it('falls back to the hostname when process is absent', () => {
    const saved = globalThis.process;
    // @ts-expect-error simulating a bare browser
    delete globalThis.process;
    try {
      expect(isDevelopment()).toBe(true);
    } finally {
      globalThis.process = saved;
    }
  });
});
