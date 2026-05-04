import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  resolveAdapterConfig,
  shouldProbeRuntime,
  type ConfigField,
} from './core';

interface AdapterConfig {
  token?: string;
  endpoint?: string;
  timeout?: number;
}

const FIELDS: ConfigField<AdapterConfig>[] = [
  { key: 'token', env: ['MY_ADAPTER_TOKEN'] },
  { key: 'endpoint', env: ['MY_ADAPTER_ENDPOINT'] },
  { key: 'timeout' }, // optional tuning field, no env fallback
];

describe('shouldProbeRuntime', () => {
  beforeEach(() => {
    delete process.env.MY_ADAPTER_TOKEN;
    delete process.env.MY_ADAPTER_ENDPOINT;
  });

  it('returns false when overrides cover every env-backed field', () => {
    expect(
      shouldProbeRuntime(FIELDS, { token: 't', endpoint: 'u' }),
    ).toBe(false);
  });

  it('returns false when env covers every env-backed field', () => {
    process.env.MY_ADAPTER_TOKEN = 't';
    process.env.MY_ADAPTER_ENDPOINT = 'u';
    expect(shouldProbeRuntime(FIELDS)).toBe(true);
  });

  it('returns true when an env-backed field is still missing', () => {
    process.env.MY_ADAPTER_TOKEN = 't';
    expect(shouldProbeRuntime(FIELDS)).toBe(true);
  });

  it('ignores fields with no env list (optional tuning fields)', () => {
    process.env.MY_ADAPTER_TOKEN = 't';
    process.env.MY_ADAPTER_ENDPOINT = 'u';
    // `timeout` is still a runtime-resolvable field, so probing may still apply.
    expect(shouldProbeRuntime(FIELDS)).toBe(true);
  });
});

describe('resolveAdapterConfig', () => {
  beforeEach(() => {
    delete process.env.MY_ADAPTER_TOKEN;
    delete process.env.MY_ADAPTER_ENDPOINT;
  });
  afterEach(() => vi.restoreAllMocks());

  it('calls the probe when overrides do not fully resolve config', async () => {
    process.env.MY_ADAPTER_TOKEN = 't';
    process.env.MY_ADAPTER_ENDPOINT = 'u';

    const probe = vi.fn().mockResolvedValue(undefined);
    const cfg = await resolveAdapterConfig('my-adapter', FIELDS, undefined, probe);

    expect(probe).toHaveBeenCalledOnce();
    expect(cfg.token).toBe('t');
    expect(cfg.endpoint).toBe('u');
  });

  it('calls the probe and merges runtimeConfig.autotel.<namespace>.<key>', async () => {
    const probe = vi.fn().mockResolvedValue({
      autotel: { 'my-adapter': { token: 'from-runtime', endpoint: 'rt-url' } },
    });
    const cfg = await resolveAdapterConfig('my-adapter', FIELDS, undefined, probe);

    expect(probe).toHaveBeenCalledOnce();
    expect(cfg.token).toBe('from-runtime');
    expect(cfg.endpoint).toBe('rt-url');
  });

  it('overrides win over runtime and env', async () => {
    process.env.MY_ADAPTER_TOKEN = 'env-token';
    const probe = vi.fn().mockResolvedValue({
      autotel: { 'my-adapter': { token: 'rt-token', endpoint: 'rt-url' } },
    });

    const cfg = await resolveAdapterConfig(
      'my-adapter',
      FIELDS,
      { token: 'override' },
      probe,
    );

    expect(cfg.token).toBe('override');
    expect(cfg.endpoint).toBe('rt-url');
  });

  it('runtime config wins over env when both are present', async () => {
    process.env.MY_ADAPTER_TOKEN = 'env-token';
    process.env.MY_ADAPTER_ENDPOINT = 'env-url';

    const probe = vi.fn().mockResolvedValue({
      autotel: { 'my-adapter': { token: 'rt-token', endpoint: 'rt-url' } },
    });
    const cfg = await resolveAdapterConfig('my-adapter', FIELDS, undefined, probe);

    expect(cfg.token).toBe('rt-token');
    expect(cfg.endpoint).toBe('rt-url');
  });
});
