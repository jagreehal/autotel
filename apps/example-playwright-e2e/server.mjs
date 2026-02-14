/**
 * Minimal server for Playwright e2e: started by webServer in playwright.config.
 * GET /health, GET /users/:id, POST /users, GET /error.
 * Uses autotel so test → request is one trace.
 */
import { createServer } from 'node:http';
import { init, getTracer, context as otelContext, trace } from 'autotel';
import { extractTraceContext } from 'autotel/http';

const PORT = Number(process.env.PORT) || 3000;

init({ service: 'playwright-e2e-server', debug: true, endpoint: process.env.OTLP_ENDPOINT });

const tracer = getTracer('playwright-e2e-server', '1.0.0');

const fetchUser = trace((ctx) => async (userId) => {
  ctx.setAttribute('db.userId', userId);
  return { id: userId, name: `User ${userId}`, email: `user${userId}@example.com` };
});

function headersToRecord(req) {
  const record = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v !== undefined) record[k] = v;
  }
  return record;
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const pathname = url.pathname;
  const method = req.method;

  const parentCtx = extractTraceContext(headersToRecord(req));
  const span = tracer.startSpan(
    `${method} ${pathname}`,
    { attributes: { 'http.method': method, 'http.url': req.url } },
    parentCtx,
  );

  try {
    await otelContext.with(otelContext.active(), async () => {
      if (pathname === '/health') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
        return;
      }

      if (pathname === '/error') {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'intentional server error' }));
        return;
      }

      const userMatch = pathname.match(/^\/users\/([^/]+)$/);
      if (userMatch && method === 'GET') {
        const user = await fetchUser(userMatch[1]);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(user));
        return;
      }

      if (pathname === '/users' && method === 'POST') {
        const body = await readBody(req);
        res.statusCode = 201;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ id: 'new-1', ...body }));
        return;
      }

      res.statusCode = 404;
      res.end('Not found');
    });
  } finally {
    span.end();
  }
}).listen(PORT, () => {
  console.log(`Server http://localhost:${PORT} (health, users, error)`);
});
