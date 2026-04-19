import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { createApp, type App } from './app';

async function main() {
  const app = await createApp();
  await app.start();

  if (app.config.transport === 'stdio') {
    const transport = new StdioServerTransport();
    await app.server.connect(transport);
    console.error('autotel-mcp running on stdio');
    if (app.config.backend === 'collector') {
      console.error(`OTLP receiver on 127.0.0.1:${app.config.collectorPort}`);
    }
    return;
  }

  const sseTransports = new Map<string, SSEServerTransport>();
  const streamableTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  if (app.config.transport === 'http') {
    await app.server.connect(streamableTransport);
  }

  const httpServer = createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        await handleHealth(app, res);
        return;
      }
      if (app.config.transport === 'http' && req.url === '/mcp') {
        await streamableTransport.handleRequest(req, res);
        return;
      }
      if (app.config.transport === 'sse') {
        await handleSseRequest(app, req, res, sseTransports);
        return;
      }
      res.writeHead(404);
      res.end('Not Found');
    } catch (err) {
      console.error('[autotel-mcp] request error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
    }
  });

  const { port, host } = app.config;
  httpServer.listen(port, host, () => {
    console.error(
      `autotel-mcp ${app.config.transport.toUpperCase()} server on ${host}:${port}`,
    );
    if (app.config.transport === 'sse') {
      console.error(`  GET  http://${host}:${port}/sse     (establish stream)`);
      console.error(`  POST http://${host}:${port}/messages (send message)`);
    } else {
      console.error(`  POST http://${host}:${port}/mcp`);
    }
    console.error(`  GET  http://${host}:${port}/health`);
    if (app.config.backend === 'collector') {
      console.error(`OTLP receiver on ${host}:${app.config.collectorPort}`);
    }
  });

  const shutdown = async () => {
    await app.stop();
    httpServer.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function handleHealth(app: App, res: ServerResponse): Promise<void> {
  const health = await app.backend.healthCheck();
  const capabilities = app.backend.capabilities();
  const body = {
    status: health.healthy ? 'healthy' : 'unhealthy',
    backend: app.backend.kind,
    transport: app.config.transport,
    signals: capabilities,
    detail: health.message ?? null,
    version: '0.1.1',
  };
  res.writeHead(health.healthy ? 200 : 503, {
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify(body));
}

async function handleSseRequest(
  app: App,
  req: IncomingMessage,
  res: ServerResponse,
  transports: Map<string, SSEServerTransport>,
): Promise<void> {
  if (req.method === 'GET' && (req.url === '/sse' || req.url === '/')) {
    const transport = new SSEServerTransport('/messages', res);
    transports.set(transport.sessionId, transport);
    res.on('close', () => {
      transports.delete(transport.sessionId);
    });
    await app.server.connect(transport);
    return;
  }
  if (req.method === 'POST' && req.url?.startsWith('/messages')) {
    const url = new URL(req.url, 'http://localhost');
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing sessionId query parameter' }));
      return;
    }
    const transport = transports.get(sessionId);
    if (!transport) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Unknown sessionId: ${sessionId}` }));
      return;
    }
    await transport.handlePostMessage(req, res);
    return;
  }
  res.writeHead(404);
  res.end('Not Found');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
