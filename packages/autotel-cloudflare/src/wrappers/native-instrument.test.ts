import { describe, it, expect, vi } from 'vitest';
import { instrument } from './instrument';
import { span } from 'autotel-edge';
import { isWrapped } from '../bindings/common';

/**
 * A KV-shaped binding so instrumentBindings() would proxy it in the OTLP path.
 * In native mode we must NOT proxy it (Cloudflare traces KV natively) — these
 * tests assert that the handler receives the original, unwrapped binding and
 * that user spans route to ctx.tracing.enterSpan instead of the OTel pipeline.
 */
function fakeKv() {
  return {
    get: vi.fn(async () => 'value'),
    put: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    list: vi.fn(async () => ({ keys: [] })),
  };
}

function nativeCtx() {
  const enteredSpans: string[] = [];
  const waitUntil = vi.fn();
  const ctx = {
    waitUntil,
    passThroughOnException() {},
    tracing: {
      enterSpan: vi.fn((name: string, cb: (s: any) => unknown) => {
        enteredSpans.push(name);
        return cb({ isTraced: true, setAttribute: vi.fn() });
      }),
    },
  };
  return { ctx, enteredSpans, waitUntil };
}

const baseConfig = {
  service: { name: 'native-test' },
  exporter: { url: 'http://localhost:4318/v1/traces' },
} as const;

describe('instrument() with Cloudflare native tracing (auto)', () => {
  it('defers binding instrumentation to the platform (no proxy wrapping)', async () => {
    const { ctx } = nativeCtx();
    const kv = fakeKv();
    let seenBinding: unknown;

    const handler = instrument(
      {
        async fetch(_req, env: { MY_KV: ReturnType<typeof fakeKv> }) {
          seenBinding = env.MY_KV;
          await env.MY_KV.get('k');
          return new Response('ok');
        },
      },
      baseConfig,
    );

    await handler.fetch!(new Request('https://x/'), { MY_KV: kv }, ctx as never);

    // Handler received the ORIGINAL binding, not an autotel proxy.
    expect(seenBinding).toBe(kv);
    expect(isWrapped(seenBinding)).toBe(false);
    // No "KV ...: get" span was created via the native tracer.
    expect(
      ctx.tracing.enterSpan.mock.calls.some(([name]) =>
        String(name).startsWith('KV '),
      ),
    ).toBe(false);
  });

  it('surfaces the cf-ray header as a correlation.id span attribute', async () => {
    const attrs: Record<string, unknown> = {};
    const ctx = {
      waitUntil() {},
      passThroughOnException() {},
      tracing: {
        enterSpan: vi.fn((_name: string, cb: (s: any) => unknown) =>
          cb({
            isTraced: true,
            setAttribute(k: string, v: unknown) {
              attrs[k] = v;
            },
          }),
        ),
      },
    };

    const handler = instrument(
      { async fetch() { return span('work', () => new Response('ok')); } },
      baseConfig,
    );

    const req = new Request('https://x/', { headers: { 'cf-ray': 'ray-7f' } });
    await handler.fetch!(req, {}, ctx as never);
    expect(attrs['correlation.id']).toBe('ray-7f');
  });

  it('routes user span() calls to ctx.tracing.enterSpan', async () => {
    const { ctx, enteredSpans } = nativeCtx();

    const handler = instrument(
      {
        async fetch() {
          return span('user.work', (s) => {
            s.setAttribute('ok', true);
            return new Response('done');
          });
        },
      },
      baseConfig,
    );

    const res = await handler.fetch!(new Request('https://x/'), {}, ctx as never);
    expect(await res.text()).toBe('done');
    expect(enteredSpans).toContain('user.work');
  });

  it('does not run the OTLP export flow (no waitUntil) in native mode', async () => {
    const { ctx, waitUntil } = nativeCtx();
    const handler = instrument(
      { async fetch() { return new Response('ok'); } },
      baseConfig,
    );
    await handler.fetch!(new Request('https://x/'), {}, ctx as never);
    expect(waitUntil).not.toHaveBeenCalled();
  });
});

describe('instrument() with nativeTracing: "off"', () => {
  it('ignores ctx.tracing and uses the autotel pipeline (proxies bindings)', async () => {
    const { ctx } = nativeCtx();
    const kv = fakeKv();
    let seenBinding: unknown;

    const handler = instrument(
      {
        async fetch(_req, env: { MY_KV: ReturnType<typeof fakeKv> }) {
          seenBinding = env.MY_KV;
          return new Response('ok');
        },
      },
      { ...baseConfig, nativeTracing: 'off' },
    );

    await handler.fetch!(new Request('https://x/'), { MY_KV: kv }, ctx as never);

    // OTLP path proxies the binding, so the handler sees a wrapped object.
    expect(isWrapped(seenBinding)).toBe(true);
    // Native tracer was never used.
    expect(ctx.tracing.enterSpan).not.toHaveBeenCalled();
  });
});
