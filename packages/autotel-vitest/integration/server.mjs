import { createServer } from 'node:http';
import { init, getTracer, context as otelContext, trace } from 'autotel';
import { extractTraceContext } from 'autotel/http';

const PORT = Number(process.env.PORT) || 3399;

init({
  service: 'autotel-vitest-compat-server',
  endpoint: process.env.OTLP_ENDPOINT,
});

const tracer = getTracer('autotel-vitest-compat-server', '1.0.0');

const fetchUser = trace((ctx) => async (userId) => {
  ctx.setAttribute('db.userId', userId);
  return { id: userId, name: `User ${userId}` };
});

function headersToRecord(req) {
  const record = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) record[key] = value;
  }
  return record;
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const pathname = url.pathname;
  const method = req.method || 'GET';

  const parentCtx = extractTraceContext(headersToRecord(req));
  const span = tracer.startSpan(`${method} ${pathname}`, undefined, parentCtx);

  try {
    await otelContext.with(parentCtx, async () => {
      if (pathname === '/health') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: 'ok' }));
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
}).listen(PORT);
