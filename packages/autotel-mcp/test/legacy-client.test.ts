import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createApp, type App } from '../src/app';

/**
 * The clients people actually have installed.
 *
 * Claude Code, Claude Desktop, Cursor and the rest ship the v1 SDK, which tops
 * out at 2025-11-25 and opens with the `initialize` handshake this server no
 * longer speaks natively. They are served by the SDK's stateless legacy path —
 * a claim that is worth nothing unless a 2025-era client actually connects, so
 * this suite drives the real v1 client against the real entry point.
 */
describe('2025-era clients', () => {
  let app: App;
  let http: Server;
  let url: string;

  beforeAll(async () => {
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

  async function connectLegacy(): Promise<Client> {
    const client = new Client(
      { name: 'legacy-client-tests', version: '1.0.0' },
      { capabilities: {} },
    );
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    return client;
  }

  it('is the revision this test claims to be testing', () => {
    // Guards the premise: if the v1 SDK ever ships a modern revision, this
    // suite would quietly stop testing the legacy path.
    expect(LATEST_PROTOCOL_VERSION).toBe(app.legacyProtocolVersion);
    expect(LATEST_PROTOCOL_VERSION).not.toBe(app.protocolVersion);
  });

  it('completes the initialize handshake', async () => {
    const client = await connectLegacy();
    expect(client.getServerVersion()?.name).toBe('autotel-mcp');
    expect(client.getServerCapabilities()).toMatchObject({ tools: {} });
    await client.close();
  });

  it('lists and calls tools', async () => {
    const client = await connectLegacy();

    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools[0]?.annotations?.readOnlyHint).toBe(true);

    const result = await client.callTool({
      name: 'backend_capabilities',
      arguments: {},
    });
    const [content] = result.content as { type: string; text: string }[];
    expect(JSON.parse(content!.text)).toMatchObject({ ok: true });

    await client.close();
  });

  it('reads resources', async () => {
    const client = await connectLegacy();
    const { resources } = await client.listResources();
    expect(resources.length).toBeGreaterThan(0);
    await client.close();
  });
});
