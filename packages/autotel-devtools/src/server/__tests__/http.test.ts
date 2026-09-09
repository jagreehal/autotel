// src/server/__tests__/http.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'node:http';
import { DevtoolsServer } from '../server';
import { attachDevtoolsRoutes } from '../http';

describe('HTTP server', () => {
  let httpServer: any = null;
  let wsServer: DevtoolsServer | null = null;

  afterEach(async () => {
    if (wsServer) await wsServer.close();
    if (httpServer) await new Promise<void>((r) => httpServer.close(r));
    wsServer = null;
    httpServer = null;
  });

  it('lets an instrumented browser client send its trace headers', async () => {
    httpServer = createServer();
    wsServer = new DevtoolsServer({ server: httpServer });
    attachDevtoolsRoutes(httpServer, wsServer);
    await new Promise<void>((r) => httpServer.listen(0, '127.0.0.1', r));
    const port = httpServer.address().port;

    // What a browser sends before an autotel-web instrumented fetch to the
    // query API: the propagator has added `traceparent`, so the request is no
    // longer simple and Chrome preflights it first.
    const res = await fetch(`http://127.0.0.1:${port}/api/query/traces`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'traceparent,baggage',
      },
    });

    expect(res.status).toBe(204);
    const allowed = res.headers.get('access-control-allow-headers') ?? '';
    expect(allowed.toLowerCase()).toContain('traceparent');
    expect(allowed.toLowerCase()).toContain('baggage');
  });

  it('accepts OTLP trace data at POST /v1/traces', async () => {
    httpServer = createServer();
    wsServer = new DevtoolsServer({ server: httpServer });
    attachDevtoolsRoutes(httpServer, wsServer);
    await new Promise<void>((r) => httpServer.listen(0, '127.0.0.1', r));
    const port = httpServer.address().port;

    const payload = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'test' } },
            ],
          },
          scopeSpans: [
            {
              scope: {},
              spans: [
                {
                  traceId: 'abc',
                  spanId: 'def',
                  name: 'test-span',
                  kind: 2,
                  startTimeUnixNano: '1000000000',
                  endTimeUnixNano: '2000000000',
                  status: { code: 1 },
                },
              ],
            },
          ],
        },
      ],
    };

    const res = await fetch(`http://127.0.0.1:${port}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.acceptedTraces).toBe(1);
    expect(wsServer.getCurrentData().traces).toHaveLength(1);
  });

  it('serves fullpage HTML at GET /', async () => {
    httpServer = createServer();
    wsServer = new DevtoolsServer({ server: httpServer });
    attachDevtoolsRoutes(httpServer, wsServer);
    await new Promise<void>((r) => httpServer.listen(0, '127.0.0.1', r));
    const port = httpServer.address().port;

    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('autotel-devtools');
  });

  it('uses the configured title as the page title, escaped', async () => {
    httpServer = createServer();
    wsServer = new DevtoolsServer({ server: httpServer });
    attachDevtoolsRoutes(httpServer, wsServer, {
      title: 'Checkout <svc> & "co"',
    });
    await new Promise<void>((r) => httpServer.listen(0, '127.0.0.1', r));
    const port = httpServer.address().port;

    const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    expect(html).toContain(
      '<title>Checkout &lt;svc&gt; &amp; &quot;co&quot;</title>',
    );
    expect(html).not.toContain('<svc>');
  });

  it('returns health check at GET /healthz', async () => {
    httpServer = createServer();
    wsServer = new DevtoolsServer({ server: httpServer });
    attachDevtoolsRoutes(httpServer, wsServer);
    await new Promise<void>((r) => httpServer.listen(0, '127.0.0.1', r));
    const port = httpServer.address().port;

    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('returns 404 for unknown routes', async () => {
    httpServer = createServer();
    wsServer = new DevtoolsServer({ server: httpServer });
    attachDevtoolsRoutes(httpServer, wsServer);
    await new Promise<void>((r) => httpServer.listen(0, '127.0.0.1', r));
    const port = httpServer.address().port;

    const res = await fetch(`http://127.0.0.1:${port}/unknown`);
    expect(res.status).toBe(404);
  });
});
