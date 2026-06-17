/**
 * Evidence capture harness.
 *
 * Drives a kitchen-sink autotel handler through BOTH tracing modes against the
 * real built packages and prints the exact span trees autotel produces:
 *
 *   1. OTLP mode      — autotel's own pipeline (other runtimes / local dev /
 *                       nativeTracing:'off'). Bindings are auto-instrumented.
 *   2. Native mode    — Cloudflare native tracing (a mock `ctx.tracing` stands
 *                       in for the runtime). autotel defers binding spans to the
 *                       platform and routes custom spans to enterSpan().
 *
 * Run: `node scripts/capture-evidence.mjs`
 */
import { wrapModule, trace, span } from 'autotel-cloudflare';

// ── Mock bindings (shape-detected by autotel in OTLP mode) ──────────────────
const kv = {
  get: async (k) => (k === 'pricing' ? '{"tax":0.2}' : null),
  put: async () => {},
  delete: async () => {},
  list: async () => ({ keys: [] }),
};
const d1 = {
  prepare: (q) => ({
    bind: () => ({
      first: async () => ({ id: 'u1' }),
      all: async () => ({ results: [{ id: 'u1' }, { id: 'u2' }] }),
      run: async () => ({ success: true }),
    }),
    first: async () => ({ id: 'u1' }),
    all: async () => ({ results: [{ id: 'u1' }, { id: 'u2' }] }),
    run: async () => ({ success: true }),
    raw: async () => [],
    __q: q,
  }),
  exec: async () => ({ count: 1 }),
};
const env = { MY_KV: kv, MY_D1: d1 };

// ── Kitchen-sink business logic (same trace()/span() API in both modes) ─────
const priceOrder = trace(
  {
    name: 'order.price',
    attributesFromArgs: ([id]) => ({ 'order.id': id }),
    attributesFromResult: (r) => ({ 'order.total': r.total }),
  },
  (ctx) =>
    async function priceOrder(id, e) {
      const subtotal = await span('order.subtotal', async (s) => {
        await e.MY_KV.get('pricing'); // KV span (native: platform; OTLP: autotel)
        s.setAttribute('order.subtotal', 100);
        return 100;
      });
      const total = span('order.total', (s) => {
        const t = Math.round(subtotal * 1.2);
        s.setAttribute('order.total', t);
        return t;
      });
      ctx.setAttribute('order.correlation', ctx.correlationId || '(none)');
      return { id, subtotal, total };
    },
);

const createUser = trace('user.create', (ctx) =>
  async function createUser(e) {
    const exists = await span('db.checkDuplicate', async () => {
      const row = await e.MY_D1.prepare('SELECT id FROM users WHERE email=?')
        .bind('a@b.com')
        .first();
      return !!row;
    });
    if (exists) {
      ctx.setAttribute('user.duplicate', true);
    }
    return { created: !exists };
  },
);

const failing = trace('payment.charge', async () => {
  throw new Error('card declined');
});

async function runScenarios(e) {
  await priceOrder('ORD-1', e);
  await createUser(e);
  try {
    await failing();
  } catch {
    /* expected — captured on the span */
  }
}

// ── Capture helpers ─────────────────────────────────────────────────────────
const STATUS = { 0: 'UNSET', 1: 'OK', 2: 'ERROR' };

function summariseOtlp(spans) {
  return spans.map((s) => {
    const sc = s.spanContext?.() ?? {};
    const parent = s.parentSpanContext?.spanId ?? s.parentSpanId ?? null;
    return {
      name: s.name,
      spanId: sc.spanId,
      parentSpanId: parent,
      status: STATUS[s.status?.code] ?? 'UNSET',
      attributes: Object.fromEntries(
        Object.entries(s.attributes ?? {}).filter(([k]) =>
          /^(order|user|payment|db|kv|cache|code|error|exception|correlation)/.test(k),
        ),
      ),
    };
  });
}

function printTree(rows, parentKey) {
  // OTLP: build parent→children from spanId/parentSpanId.
  const byParent = new Map();
  for (const r of rows) {
    const p = r[parentKey] ?? '∅';
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(r);
  }
  const roots = rows.filter((r) => !rows.some((o) => o.spanId === r[parentKey]));
  const walk = (r, depth) => {
    const ind = '  '.repeat(depth);
    const attrs = Object.entries(r.attributes)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(' ');
    console.log(`${ind}• ${r.name} [${r.status}]${attrs ? '  ' + attrs : ''}`);
    for (const c of byParent.get(r.spanId) ?? []) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
}

// ── Mode 1: OTLP pipeline (custom in-memory span processor) ─────────────────
async function captureOtlp() {
  const captured = [];
  const processor = {
    onStart() {},
    onEnd(s) {
      captured.push(s);
    },
    forceFlush: async () => {},
    shutdown: async () => {},
  };

  const handler = wrapModule(
    { service: { name: 'kitchen-sink' }, nativeTracing: 'off', spanProcessors: [processor] },
    { async fetch(_req, e) {
        await runScenarios(e);
        return new Response('ok');
      } },
  );

  await handler.fetch(new Request('https://x/orders'), env, {
    waitUntil() {},
    passThroughOnException() {},
  });

  const rows = summariseOtlp(captured);
  console.log('\n=== MODE 1 — autotel OTLP pipeline (local dev / non-Workers / nativeTracing:"off") ===');
  console.log(`captured ${rows.length} spans (incl. autotel-instrumented bindings)\n`);
  printTree(rows, 'parentSpanId');
  return rows;
}

// ── Mode 2: Cloudflare native tracing (mock ctx.tracing) ────────────────────
async function captureNative() {
  const stack = [];
  const tree = [];
  const tracing = {
    enterSpan(name, cb) {
      const node = { name, attributes: {}, children: [], status: 'OK' };
      (stack.length ? stack[stack.length - 1].children : tree).push(node);
      stack.push(node);
      const handle = {
        isTraced: true,
        setAttribute(k, v) {
          if (v !== undefined) node.attributes[k] = v;
          if (k === 'error') node.status = 'ERROR';
        },
      };
      const done = () => stack.pop();
      try {
        const r = cb(handle);
        if (r && typeof r.then === 'function') {
          return r.then(
            (val) => (done(), val),
            (err) => (done(), Promise.reject(err)),
          );
        }
        done();
        return r;
      } catch (e) {
        done();
        throw e;
      }
    },
  };

  const handler = wrapModule(
    { service: { name: 'kitchen-sink' } }, // nativeTracing defaults to 'auto'
    { async fetch(_req, e) {
        await runScenarios(e);
        return new Response('ok');
      } },
  );

  await handler.fetch(
    new Request('https://x/orders', { headers: { 'cf-ray': '8f1c2d3e4a5b6c7d-LHR' } }),
    env,
    { waitUntil() {}, passThroughOnException() {}, tracing },
  );

  console.log('\n=== MODE 2 — Cloudflare native tracing (autotel routes to ctx.tracing.enterSpan) ===');
  console.log('these nest under Cloudflare\'s automatic platform spans (fetch/KV/handler) on deploy\n');
  const walk = (n, d) => {
    const attrs = Object.entries(n.attributes)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(' ');
    console.log(`${'  '.repeat(d)}• ${n.name} [${n.status}]${attrs ? '  ' + attrs : ''}`);
    n.children.forEach((c) => walk(c, d + 1));
  };
  tree.forEach((n) => walk(n, 0));
  return tree;
}

const otlp = await captureOtlp();
const native = await captureNative();

const fs = await import('node:fs');
fs.writeFileSync(
  new URL('./evidence.json', import.meta.url),
  JSON.stringify({ otlp, native }, null, 2),
);
console.log('\nwrote scripts/evidence.json');
