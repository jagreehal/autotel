import { createServer, type ServerResponse } from 'node:http';
import {
  hostHeaderValidation,
  localhostHostValidation,
  localhostOriginValidation,
  originValidation,
  toNodeHandler,
} from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createApp, type App } from './app';
import { helpText, parseCliArgs } from './cli-args';
import { ConfigError, resolveConfig } from './config';
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
  //
  // A hosted server needs its own hostname named, or the Host guard refuses
  // every real request before it reaches a tool. The localhost default stands
  // until somebody says otherwise, so a laptop keeps the guard it had.
  const { allowedHosts, allowedOrigins } = app.config;
  const checkHost =
    allowedHosts.length > 0
      ? hostHeaderValidation(allowedHosts)
      : localhostHostValidation();
  const checkOrigin =
    allowedOrigins.length > 0
      ? originValidation(allowedOrigins)
      : localhostOriginValidation();

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
        res.end(
          JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }
  });

  const { port, host } = app.config;
  httpServer.listen(port, host, () => {
    console.error(
      `autotel-mcp HTTP server on ${host}:${port} (MCP ${app.protocolVersion}; ` +
        `${app.legacyProtocolVersion} clients served too)`,
    );
    // Naming hosts replaces the localhost default rather than adding to it, so
    // the bind address printed above stops answering. Say so here: otherwise
    // the first thing anyone tries is a curl at 127.0.0.1 and a 403 that reads
    // like the server is broken.
    const reachableHost = allowedHosts[0] ?? host;
    console.error(`  POST http://${reachableHost}:${port}/mcp`);
    console.error(`  GET  http://${reachableHost}:${port}/health`);
    if (allowedHosts.length > 0) {
      console.error(
        `  Host header must be one of: ${allowedHosts.join(', ')} — localhost is not, unless named`,
      );
    }
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
  // A settings mistake gets its message and nothing else; the stack points at
  // the parser, not at the line the operator has to change. Anything else is a
  // crash, and its stack is the useful part.
  if (err instanceof ConfigError) {
    console.error(err.message);
  } else {
    console.error('Fatal:', err);
  }
  process.exit(1);
});
