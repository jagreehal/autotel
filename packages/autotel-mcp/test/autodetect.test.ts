import { afterEach, describe, expect, it } from 'vitest';
import { probeAll } from '../src/backends/autodetect';

describe('autodetect', () => {
  let originalFetch: typeof fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('probes the expected path per backend kind', async () => {
    const calls: string[] = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push(url);
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

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
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('prom')) return new Response('ok', { status: 200 });
      throw new Error('connection refused');
    }) as typeof fetch;

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
