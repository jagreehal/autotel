import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevtoolsBackend } from './index';

afterEach(() => vi.unstubAllGlobals());

describe('DevtoolsBackend.agentUsage', () => {
  it('passes the filter through as query parameters', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      return Response.json({ sessions: [], cost: 'unknown' });
    });
    const report = await new DevtoolsBackend('http://dt').agentUsage({
      repository: 'autotel',
      latest: 'prompt',
    });
    expect(report).toEqual({ sessions: [], cost: 'unknown' });
    expect(urls[0]).toBe(
      'http://dt/api/agents/usage?repository=autotel&latest=prompt',
    );
  });

  it('reads a devtools without the route as unsupported', async () => {
    vi.stubGlobal(
      'fetch',
      async () => new Response('not found', { status: 404 }),
    );
    await expect(
      new DevtoolsBackend('http://dt').agentUsage({}),
    ).resolves.toBeUndefined();
  });
});

describe('DevtoolsBackend.semconvValidation', () => {
  it('reads the latest result, or POSTs to run a fresh one', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return Response.json({ status: 'idle' });
    });
    const backend = new DevtoolsBackend('http://dt');
    await backend.semconvValidation(false);
    await backend.semconvValidation(true);
    expect(calls).toEqual([
      'GET http://dt/api/validation',
      'POST http://dt/api/validation/run',
    ]);
  });
});
