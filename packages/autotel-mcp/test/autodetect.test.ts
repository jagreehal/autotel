import { afterEach, describe, expect, it } from 'vitest';
import { probeAll } from '../src/backends/autodetect';
import { installFetchHandler } from './helpers/fetch';

describe('autodetect', () => {
  let originalFetch: typeof fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('probes the expected path per backend kind', async () => {
    const calls: string[] = [];
    originalFetch = globalThis.fetch;
    installFetchHandler(async (url) => {
      calls.push(url);
      return new Response('ok', { status: 200 });
    });

    await probeAll({
      tempo: 'http://tempo.local',
      jaeger: 'http://jaeger.local',
      prometheus: 'http://prom.local',
      loki: 'http://loki.local',
    });

    expect(calls).toContain('http://tempo.local/api/echo');
    expect(calls).toContain('http://jaeger.local/api/services');
    expect(calls).toContain('http://prom.local/api/v1/status/buildinfo');
    expect(calls).toContain('http://loki.local/ready');
  });

  it('marks unreachable backends as reachable=false without throwing', async () => {
    originalFetch = globalThis.fetch;
    installFetchHandler(async (url) => {
      if (url.includes('prom')) return new Response('ok', { status: 200 });
      throw new Error('connection refused');
    });

    const results = await probeAll({
      tempo: 'http://tempo.local',
      prometheus: 'http://prom.local',
    });
    const prom = results.find((r) => r.kind === 'prometheus');
    const tempo = results.find((r) => r.kind === 'tempo');
    expect(prom?.reachable).toBe(true);
    expect(tempo?.reachable).toBe(false);
  });
});
