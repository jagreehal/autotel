import { createServer, type ServerResponse } from 'node:http';
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createApp, type App } from './app';
import { helpText, parseCliArgs } from './cli-args';
import { resolveConfig } from './config';
import { VERSION } from './version';

async function main() {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(helpText());
    return;
  }
  if (parsed.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  // Reported here rather than left to resolveConfig's throw: a stack trace is
  // the wrong answer to a typo, and a CLI owes its caller an exit code.
  if (parsed.errors.length > 0) {
    for (const error of parsed.errors) {
      console.error(`autotel-mcp: ${error}`);
    }
    console.error('\nRun `autotel-mcp --help` for usage.');
    process.exit(2);
  }

  const app = await createApp({ config: resolveConfig(parsed) });
  await app.start();

  if (app.config.transport === 'stdio') {
    // The factory is called once per connection here, and once per request
    // over HTTP. Either way it is the same definition of the same tools.
    const stdio = serveStdio(app.createServer, {
      onerror: (error) => console.error('[autotel-mcp]', error.message),
    });
    console.error(
      `autotel-mcp running on stdio (MCP ${app.protocolVersion}; ` +
        `${app.legacyProtocolVersion} clients served too)`,
    );
    if (app.config.backend === 'collector') {
      console.error(`OTLP receiver on 127.0.0.1:${app.config.collectorPort}`);
    }
    installShutdown(app, () => stdio.close());
    return;
  }

  // 2026-07-28 removed the initialize handshake and the session header, so
  // there is nothing to attach an instance to: `createMcpHandler` builds one
  // per request from the factory. `legacy: 'stateless'` keeps 2025-era clients
  // working through the same factory, which is what the MCP clients in the
  // wild still speak.
  const handler = createMcpHandler(app.createServer, {
    onerror: (error) => console.error('[autotel-mcp]', error.message),
  });
  const nodeHandler = toNodeHandler(handler);

  // DNS-rebinding and cross-origin guards, which the spec requires of every
  // local HTTP server: a page on any origin can otherwise reach a server bound
  // to 127.0.0.1. Both answer rejected requests themselves and return false,
  // so nothing may touch the response afterwards.
  const checkHost = localhostHostValidation();
  const checkOrigin = localhostOriginValidation();

  const httpServer = createServer(async (req, res) => {
    try {
      if (!checkHost(req, res) || !checkOrigin(req, res)) return;

      if (req.method === 'GET' && req.url === '/health') {
        await handleHealth(app, res);
        return;
      }
      const { pathname } = new URL(req.url ?? '/', 'http://localhost');
      if (pathname === '/mcp') {
        await nodeHandler(req, res);
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
      `autotel-mcp HTTP server on ${host}:${port} (MCP ${app.protocolVersion}; ` +
        `${app.legacyProtocolVersion} clients served too)`,
    );
    console.error(`  POST http://${host}:${port}/mcp`);
    console.error(`  GET  http://${host}:${port}/health`);
    if (app.config.backend === 'collector') {
      console.error(`OTLP receiver on ${host}:${app.config.collectorPort}`);
    }
  });

  installShutdown(app, async () => {
    httpServer.close();
  });
}

function installShutdown(app: App, closeTransport: () => Promise<void> | void) {
  const shutdown = async () => {
    await closeTransport();
    await app.stop();
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
    protocol: {
      revision: app.protocolVersion,
      legacy: app.legacyProtocolVersion,
    },
    signals: capabilities,
    detail: health.message ?? null,
    version: VERSION,
  };
  res.writeHead(health.healthy ? 200 : 503, {
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify(body));
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
