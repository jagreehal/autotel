import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'node:http';
import { createApp } from './app.js';

async function main() {
  const app = await createApp();
  await app.start();

  if (app.config.transport === 'http') {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await app.server.connect(transport);

    const httpServer = createServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        const health = await app.backend.healthCheck();
        res.writeHead(health.healthy ? 200 : 503, {
          'Content-Type': 'application/json',
        });
        res.end(JSON.stringify(health));
        return;
      }
      if (req.url === '/mcp') {
        await transport.handleRequest(req, res);
        return;
      }
      res.writeHead(404);
      res.end('Not Found');
    });

    const port = app.config.port;
    const host = app.config.host;
    httpServer.listen(port, host, () => {
      console.error(`autotel-mcp HTTP server on ${host}:${port}`);
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
  } else {
    const transport = new StdioServerTransport();
    await app.server.connect(transport);
    console.error('autotel-mcp running on stdio');
    if (app.config.backend === 'collector') {
      console.error(`OTLP receiver on 127.0.0.1:${app.config.collectorPort}`);
    }
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
