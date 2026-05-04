import { describe, it, expect, vi } from 'vitest';
import { defineWorkerFetch } from './define-worker-fetch';

describe('defineWorkerFetch', () => {
  interface Env {
    SERVICE_NAME?: string;
  }

  it('returns an object with a fetch method', () => {
    const worker = defineWorkerFetch<Env>(
      { service: { name: 'test-worker' } },
      async () => new Response('ok'),
    );

    expect(worker).toBeDefined();
    expect(typeof worker.fetch).toBe('function');
  });

  it('invokes the user handler and returns its response', async () => {
    let called = false;

    const worker = defineWorkerFetch<Env>(
      { service: { name: 'test-worker' } },
      async (request, _env, _ctx, _log) => {
        called = true;
        return new Response('hello', { status: 201 });
      },
    );

    const request = new Request('http://example.com/route');
    const env = {} as Env;
    const ctx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as any;

    const response = await worker.fetch(request, env, ctx);

    expect(called).toBe(true);
    expect(response.status).toBe(201);
    expect(await response.text()).toBe('hello');
  });

  it('passes a logger as the fourth argument', async () => {
    let receivedLog: unknown;

    const worker = defineWorkerFetch<Env>(
      { service: { name: 'test-worker' } },
      async (_request, _env, _ctx, log) => {
        receivedLog = log;
        return new Response('ok');
      },
    );

    const request = new Request('http://example.com/');
    const ctx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as any;

    await worker.fetch(request, {} as Env, ctx);

    expect(receivedLog).toBeDefined();
    expect(typeof (receivedLog as { set?: unknown }).set).toBe('function');
    expect(typeof (receivedLog as { emitNow?: unknown }).emitNow).toBe('function');
  });

  it('calls waitUntil so async exports flush before response returns', async () => {
    const worker = defineWorkerFetch<Env>(
      { service: { name: 'test-worker' } },
      async () => new Response('ok'),
    );

    const waitUntilSpy = vi.fn();
    const ctx = {
      waitUntil: waitUntilSpy,
      passThroughOnException: vi.fn(),
    } as any;

    await worker.fetch(new Request('http://example.com/'), {} as Env, ctx);

    expect(waitUntilSpy).toHaveBeenCalled();
  });

  it('propagates handler errors', async () => {
    const worker = defineWorkerFetch<Env>(
      { service: { name: 'test-worker' } },
      async () => {
        throw new Error('boom');
      },
    );

    const ctx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as any;

    await expect(
      worker.fetch(new Request('http://example.com/'), {} as Env, ctx),
    ).rejects.toThrow('boom');
  });
});
