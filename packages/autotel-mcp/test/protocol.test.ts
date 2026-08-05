import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createApp, MCP_PROTOCOL_VERSION, type App } from '../src/app';

/**
 * The wire, end to end, against a real client pinned to 2026-07-28.
 *
 * Type-checking against the SDK proves nothing about the protocol: the era is
 * decided by the HTTP entry, not by `McpServer`. Pinning the client means no
 * silent fallback to the 2025 handshake — if this server does not speak the
 * current revision, the connection fails here rather than in someone's editor.
 */
describe('MCP 2026-07-28', () => {
  let app: App;
  let http: Server;
  let url: string;

  beforeAll(async () => {
    // The fixture backend needs nothing running.
    app = await createApp({
      config: {
        backend: 'fixture',
        transport: 'http',
        port: 0,
        host: '127.0.0.1',
        collectorPort: 4318,
        fixturePath: 'does-not-exist.json',
      } as App['config'],
    });
    await app.start();

    const nodeHandler = toNodeHandler(createMcpHandler(app.createServer));
    const checkHost = localhostHostValidation();
    const checkOrigin = localhostOriginValidation();

    http = createServer(async (req, res) => {
      if (!checkHost(req, res) || !checkOrigin(req, res)) return;
      await nodeHandler(req, res);
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const address = http.address();
    if (address === null || typeof address === 'string') {
      throw new Error('expected a TCP address');
    }
    url = `http://127.0.0.1:${address.port}/mcp`;
  });

  afterAll(async () => {
    http?.close();
    await app?.stop();
  });

  async function connect(): Promise<Client> {
    const client = new Client(
      { name: 'autotel-mcp-tests', version: '0.0.0' },
      { versionNegotiation: { mode: { pin: MCP_PROTOCOL_VERSION } } },
    );
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    return client;
  }

  it('negotiates the current revision with no legacy fallback', async () => {
    // The client is pinned to MCP_PROTOCOL_VERSION, so `connect()` throwing is
    // the real failure mode here — which is also what keeps that constant
    // honest, since the SDK does not export the revision it serves. `modern`
    // is the SDK's name for the 2026-07-28 envelope wire.
    const client = await connect();
    expect(client.getProtocolEra()).toBe('modern');
    await client.close();
  });

  it('lists tools with read-only annotations and a cache hint', async () => {
    const client = await connect();
    const { tools, ttlMs, cacheScope } = await client.listTools();

    expect(tools.length).toBeGreaterThan(0);
    // Every tool here reads telemetry; a client that honours annotations can
    // run them without stopping to ask.
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
    }
    // SEP-2549: the catalog is fixed and identical for every caller, so it is
    // worth caching — which matters more now that there is no session.
    expect(ttlMs).toBe(300_000);
    expect(cacheScope).toBe('public');

    await client.close();
  });

  it('answers a tool call', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'backend_capabilities',
      arguments: {},
    });

    const [content] = result.content as { type: string; text: string }[];
    expect(content?.type).toBe('text');
    expect(JSON.parse(content!.text)).toMatchObject({ ok: true });

    await client.close();
  });

  it('refuses a cross-origin request from a browser page', async () => {
    // Binding to 127.0.0.1 is not the mitigation: any page can post to it.
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://evil.example',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(response.status).toBe(403);
  });
});
