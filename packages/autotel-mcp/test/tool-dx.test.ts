/**
 * The first few calls an agent makes against a live backend, end to end over
 * the MCP HTTP transport.
 */
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createApp, MCP_PROTOCOL_VERSION, type App } from '../src/app';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

let app: App;
let http: Server;
let url: string;

beforeAll(async () => {
  // SAFETY: the literal below names every field createApp reads; the
  // assertion only supplies the defaults this test does not vary.
  app = await createApp({
    config: {
      backend: 'fixture',
      transport: 'http',
      port: 0,
      host: '127.0.0.1',
      collectorPort: 4318,
      fixturePath: path.resolve(here, '../fixtures/telemetry.json'),
    } as App['config'],
  });
  await app.start();

  const nodeHandler = toNodeHandler(createMcpHandler(app.createServer));
  const checkHost = localhostHostValidation();
  const checkOrigin = localhostOriginValidation();
  http = createServer(async (request, response) => {
    if (!checkHost(request, response) || !checkOrigin(request, response))
      return;
    await nodeHandler(request, response);
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  // SAFETY: listen() was awaited on a host/port, so address() is AddressInfo.
  const { port } = http.address() as AddressInfo;
  url = `http://127.0.0.1:${port}/mcp`;
});

afterAll(async () => {
  http?.close();
  await app?.stop();
});

async function connect(): Promise<Client> {
  const client = new Client(
    { name: 'autotel-mcp-dx-tests', version: '0.0.0' },
    { versionNegotiation: { mode: { pin: MCP_PROTOCOL_VERSION } } },
  );
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}

async function callJson(
  client: Client,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const result = await client.callTool({ name, arguments: input });
  // SAFETY: every tool here answers with one text block.
  const [content] = result.content as { type: string; text: string }[];
  expect(result.isError, content?.text).not.toBe(true);
  return JSON.parse(content!.text);
}

describe('tool argument names', () => {
  it('every tool that filters by service calls the argument serviceName', async () => {
    // `list_services` answers with `serviceName`; the next call must take the same name.
    const client = await connect();
    const { tools } = await client.listTools();

    const usingService = tools
      .filter((tool) => {
        const { properties } = tool.inputSchema as { properties?: object };
        return properties !== undefined && 'service' in properties;
      })
      .map((tool) => tool.name);

    expect(usingService).toEqual([]);
    await client.close();
  });

  it('find_errors and check_slos accept serviceName', async () => {
    const client = await connect();

    const errors = (await callJson(client, 'find_errors', {
      serviceName: 'checkout',
      lookbackMinutes: 24 * 60,
    })) as { ok: boolean; data: { groups: { service: string }[] } };
    expect(errors.ok).toBe(true);
    for (const group of errors.data.groups) {
      expect(group.service).toBe('checkout');
    }

    const slos = (await callJson(client, 'check_slos', {
      serviceName: 'checkout',
      maxErrorRate: 0,
    })) as { ok: boolean };
    expect(slos.ok).toBe(true);

    await client.close();
  });
});

describe('score_span_instrumentation', () => {
  it('scores a span by traceId and spanId, the ids every other tool hands back', async () => {
    const client = await connect();

    const scored = (await callJson(client, 'score_span_instrumentation', {
      traceId: 'fixture-trace-1',
      spanId: 'root',
    })) as { score: number; grade: string; findings: string[] };

    expect(scored.grade).toMatch(/^[A-F]$/);
    expect(scored.score).toBeGreaterThan(0);
    await client.close();
  });

  it('does not ask for a trace id tag on a span that is already in a trace', async () => {
    const client = await connect();

    const scored = (await callJson(client, 'score_span_instrumentation', {
      span: {
        operationName: 'chargePayment',
        serviceName: 'order-api',
        hasError: false,
        tags: { 'payment.amountInCents': 1_836_000 },
      },
    })) as { findings: string[]; suggestions: string[] };

    expect(scored.findings).not.toContain('trace correlation tag is absent');
    expect(scored.suggestions).not.toContain(
      'ensure trace correlation is propagated',
    );
    await client.close();
  });
});
