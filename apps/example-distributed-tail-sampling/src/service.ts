/**
 * One file, three roles. ROLE picks which one this process is.
 *
 *   api-gateway :3001  ->  checkout-service :3002  ->  inventory-service :3003
 *
 * On a failing request inventory-service throws. checkout-service catches it and
 * serves a cached price, so it returns 200 and so does api-gateway. Two of the
 * three services look healthy from inside their own process, which is the case a
 * per-process tail sampler gets wrong.
 *
 * Started by src/index.ts, not directly.
 */

import { createServer } from 'node:http';
import {
  context,
  flush,
  init,
  propagation,
  samplingPresets,
  shutdown,
  trace,
} from 'autotel';

const ROLES = {
  gateway: {
    service: 'api-gateway',
    port: 3001,
    downstream: 3002,
    span: 'GET /checkout',
  },
  checkout: {
    service: 'checkout-service',
    port: 3002,
    downstream: 3003,
    span: 'POST /charge',
  },
  inventory: {
    service: 'inventory-service',
    port: 3003,
    downstream: undefined,
    span: 'GET /stock',
  },
} as const;

const role = ROLES[process.env.ROLE as keyof typeof ROLES];
if (!role) {
  throw new Error(`ROLE must be one of ${Object.keys(ROLES).join(', ')}`);
}

// The one difference between the two runs.
//
// 'development' exports every span and leaves the decision to the collector.
//
// The production preset decides in-process, after the operation finishes:
// baselineSampleRate 0 drops everything except what this process saw fail, and
// alwaysSampleSlow off keeps the demo from depending on timing. That is real
// tail sampling, with a one-process horizon.
const inProcess = process.env.IN_PROCESS_SAMPLING === '1';

init({
  service: role.service,
  endpoint: process.env.OTLP_ENDPOINT || 'http://localhost:4318',
  ...(inProcess
    ? {
        sampler: samplingPresets.production({
          baselineSampleRate: 0,
          alwaysSampleSlow: false,
        }),
      }
    : { sampling: 'development' as const }),
});

const server = createServer((req, res) => {
  // Continue the caller's trace rather than starting a new one.
  const incoming = propagation.extract(context.active(), req.headers);

  void context.with(incoming, async () => {
    try {
      const body = await handle(req.url ?? '/');
      respond(res, 200, body);
    } catch (error) {
      respond(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
});

async function handle(url: string): Promise<unknown> {
  return trace.run(role.span, async (ctx) => {
    ctx.setAttribute('http.route', role.span.split(' ')[1] ?? '/');
    await delay(10);

    if (!role.downstream) {
      if (url.includes('fail=1')) {
        // The only thing that actually goes wrong anywhere in this system.
        throw new Error('stock lookup failed: replica timed out');
      }
      return { stock: 12 };
    }

    const headers: Record<string, string> = {};
    propagation.inject(context.active(), headers);
    const response = await fetch(`http://127.0.0.1:${role.downstream}${url}`, {
      headers,
    });

    if (!response.ok) {
      if (role.service === 'checkout-service') {
        // The fallback that hides the failure. checkout-service degrades
        // gracefully and reports success, which is the correct thing for it to
        // do and the reason its span looks boring.
        ctx.setAttribute('checkout.used_cached_price', true);
        return { charged: true, price: 'cached' };
      }
      throw new Error(`downstream returned ${response.status}`);
    }

    return response.json();
  });
}

function respond(
  res: import('node:http').ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

server.listen(role.port, () => {
  console.log(`${role.service} listening on :${role.port}`);
});

process.on('SIGTERM', () => {
  server.close();
  void flush()
    .then(() => shutdown())
    .then(() => process.exit(0));
});
