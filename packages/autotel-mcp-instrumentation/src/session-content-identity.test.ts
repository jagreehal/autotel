/**
 * Against the real SDKs: the session order (application, then the agent's
 * handle, then the transport), what content reaches a span (error text off
 * by default, redaction hooks), `resolveOriginalTool` for caller-dependent
 * low-level schemas, and client identity across stateless Streamable HTTP.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { context, propagation } from '@opentelemetry/api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTraceCollector, type TraceCollector } from 'autotel/testing';
import { z } from 'zod';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import { Server as ServerV1 } from '@modelcontextprotocol/sdk/server/index.js';
import { McpServer as McpServerV1 } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Client as ClientV1 } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport as InMemoryTransportV1 } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { instrumentMcpServer } from './server';
import { instrumentMcpClient } from './client';
import { recordableError, rethrowOriginal, thrownInSpan } from './content';
import { decodeClientIdentity, encodeClientIdentity } from './client-identity';
import type { McpInstrumentationConfig } from './types';

let collector: TraceCollector;
beforeEach(() => {
  collector = createTraceCollector();
});

const span = (name: string) => collector.getSpansByName(`tools/call ${name}`);
const texts = (result: unknown) =>
  ((result as { content?: Array<{ text?: string }> }).content ?? []).map(
    (c) => c.text ?? '',
  );

async function v2(
  config: McpInstrumentationConfig,
  register: (server: McpServer) => void,
) {
  const server = instrumentMcpServer(
    new McpServer({ name: 't', version: '1.0.0' }),
    config,
  );
  register(server);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'c', version: '1.0.0' });
  await client.connect(clientSide);
  await client.listTools();
  return client;
}

const echo = (server: McpServer) =>
  server.registerTool(
    'echo',
    { inputSchema: z.strictObject({ msg: z.string() }) },
    async (args: { msg: string }) => ({
      content: [{ type: 'text', text: args.msg }],
    }),
  );

describe('session order', () => {
  it('takes the application session first, and the agent’s handle when it has none', async () => {
    const known = new Set(['m1']);
    const client = await v2(
      {
        sessionHandles: {
          inject: true,
          resolveSessionId: (request) => {
            const msg = (
              request as { params?: { arguments?: { msg?: string } } }
            ).params?.arguments?.msg;
            return msg && known.has(msg) ? 'app-conv-1' : undefined;
          },
        },
      },
      echo,
    );
    const app = await client.callTool({
      name: 'echo',
      arguments: { msg: 'm1', session_id: 'start' },
    });
    // The application chose: nothing issued, nothing to tell the agent.
    expect(texts(app)).toEqual(['m1']);
    expect(span('echo')[0]!.attributes).toMatchObject({
      'gen_ai.conversation.id': 'app-conv-1',
      'mcp.session_handle.source': 'hook',
    });

    const agent = await client.callTool({
      name: 'echo',
      arguments: { msg: 'unknown', session_id: 'start' },
    });
    expect(texts(agent)[0]).toContain('[session_id issued');
    expect(span('echo')[1]!.attributes['mcp.session_handle.source']).toBe(
      'minted',
    );
  });

  it('reads the baggage session with injection off', async () => {
    const client = await v2({ sessionHandles: { inject: false } }, echo);
    const { tools } = await client.listTools();
    expect(Object.keys(tools[0]!.inputSchema.properties ?? {})).not.toContain(
      'session_id',
    );
    const baggage = propagation.createBaggage({
      'session.id': { value: 'support-ticket-42' },
    });
    await context.with(propagation.setBaggage(context.active(), baggage), () =>
      client.callTool({ name: 'echo', arguments: { msg: 'hi' } }),
    );
    expect(span('echo')[0]!.attributes).toMatchObject({
      'gen_ai.conversation.id': 'support-ticket-42',
      'mcp.session_handle.source': 'context',
    });
  });

  it('looks up no tool schema when nothing can be injected', async () => {
    let lookups = 0;
    const client = await v2(
      {
        sessionHandles: { inject: false },
        // Never answers: a lookup would stall the call.
        resolveOriginalTool: () => {
          lookups++;
          return new Promise(() => {});
        },
      },
      echo,
    );
    const result = await client.callTool({
      name: 'echo',
      arguments: { msg: 'hi' },
    });
    expect(texts(result)).toEqual(['hi']);
    expect(lookups).toBe(0);
  });

  it('takes a request-scoped session from baggage before minting one', async () => {
    const client = await v2({ sessionHandles: true }, echo);
    const baggage = propagation.createBaggage({
      'session.id': { value: 'support-ticket-42' },
    });
    // The server's own request context (an HTTP middleware would set it).
    const result = await context.with(
      propagation.setBaggage(context.active(), baggage),
      () =>
        client.callTool({
          name: 'echo',
          arguments: { msg: 'hi', session_id: 'start' },
        }),
    );
    expect(texts(result)).toEqual(['hi']);
    expect(span('echo')[0]!.attributes).toMatchObject({
      'gen_ai.conversation.id': 'support-ticket-42',
      'mcp.session_handle.source': 'context',
    });
  });

  it('falls back to the transport session when nothing else chose one', async () => {
    const server = instrumentMcpServer(
      new McpServerV1({ name: 't', version: '1.0.0' }),
    );
    server.registerTool('ping', {}, async () => ({
      content: [{ type: 'text', text: 'pong' }],
    }));
    const [clientSide, serverSide] = InMemoryTransportV1.createLinkedPair();
    (serverSide as { sessionId?: string }).sessionId = 'transport-7';
    await server.connect(serverSide);
    const client = new ClientV1({ name: 'c', version: '1.0.0' });
    await client.connect(clientSide);
    await client.callTool({ name: 'ping', arguments: {} });
    expect(span('ping')[0]!.attributes).toMatchObject({
      'mcp.session.id': 'transport-7',
      'gen_ai.conversation.id': 'transport-7',
      'mcp.session_handle.source': 'transport',
    });
  });
});

const failing = (server: McpServer) => {
  server.registerTool(
    'charge',
    { inputSchema: z.strictObject({ card: z.string() }) },
    async (args: { card: string }) => {
      throw new TypeError(`card ${args.card} declined`);
    },
  );
  server.registerTool(
    'refund',
    { inputSchema: z.strictObject({ card: z.string() }) },
    async (args: { card: string }) => ({
      isError: true,
      content: [{ type: 'text', text: `refund to ${args.card} failed` }],
    }),
  );
};
const call = async (client: Client) => {
  await client
    .callTool({ name: 'charge', arguments: { card: '4111-1111' } })
    .catch(() => {});
  await client.callTool({ name: 'refund', arguments: { card: '4111-1111' } });
};

describe('captured content', () => {
  it('records failures without their text by default, and the client still gets it', async () => {
    const client = await v2({}, failing);
    const thrown = await client.callTool({
      name: 'charge',
      arguments: { card: '4111-1111' },
    });
    // The SDK turned the original error into the agent's result: untouched.
    expect(JSON.stringify(thrown)).toContain('card 4111-1111 declined');
    collector.clear();
    await call(client);
    for (const s of [...span('charge'), ...span('refund')]) {
      expect(s.status.code).toBe(2);
      expect(JSON.stringify(s)).not.toContain('4111');
    }
    expect(span('charge')[0]!.attributes['error.type']).toBe('TypeError');
    expect(span('refund')[0]!.attributes['error.type']).toBe('tool_error');
  });

  it('keeps failure text with captureErrorMessages, through redact', async () => {
    await call(
      await v2(
        {
          captureErrorMessages: true,
          redact: (text) => text.replaceAll(/\d{4}-\d{4}/g, '[card]'),
        },
        failing,
      ),
    );
    expect(span('refund')[0]!.status.message).toBe('refund to [card] failed');
    const charge = JSON.stringify(span('charge')[0]);
    expect(charge).not.toContain('4111');
  });

  it('runs payloads and intent through the redactors before recording them', async () => {
    const client = await v2(
      {
        captureToolArgs: true,
        captureToolResults: true,
        captureIntent: true,
        redactPayload: (value, info) =>
          info.kind === 'input' ? { msg: '[redacted]' } : value,
        redact: (text, info) =>
          info.kind === 'intent' ? text.replace('Alex', '[name]') : text,
      },
      echo,
    );
    await client.callTool({
      name: 'echo',
      arguments: {
        msg: 'secret',
        context: 'Looking up the order Alex placed yesterday for support.',
      },
    });
    const attributes = span('echo')[0]!.attributes;
    expect(attributes['gen_ai.tool.call.arguments']).toBe(
      '{"msg":"[redacted]"}',
    );
    expect(String(attributes['gen_ai.tool.call.result'])).toContain('secret');
    expect(attributes['mcp.tool.call.intent']).toBe(
      'Looking up the order [name] placed yesterday for support.',
    );
  });

  it('records no payload when the redactor throws', async () => {
    const client = await v2(
      {
        captureToolArgs: true,
        redactPayload: () => {
          throw new Error('redactor broke');
        },
      },
      echo,
    );
    await client.callTool({ name: 'echo', arguments: { msg: 'secret' } });
    expect(span('echo')[0]!.attributes['gen_ai.tool.call.arguments']).toBe(
      undefined,
    );
  });
});

describe('content on the client and in errors', () => {
  it('runs the client’s captured payloads through redactPayload, recording none when it throws', async () => {
    const server = instrumentMcpServer(
      new McpServer({ name: 't', version: '1.0.0' }),
      {},
    );
    echo(server);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = instrumentMcpClient(
      new Client({ name: 'c', version: '1.0.0' }),
      {
        captureToolArgs: true,
        captureToolResults: true,
        redactPayload: (_value, info) => {
          if (info.kind === 'output') throw new Error('redactor broke');
          return { msg: '[redacted]' };
        },
      },
    );
    await client.connect(clientSide);
    await client.callTool({ name: 'echo', arguments: { msg: 'secret' } });
    const clientSpan = span('echo').find((s) => s.kind === 2)!;
    expect(clientSpan.attributes['gen_ai.tool.call.arguments']).toBe(
      '{"msg":"[redacted]"}',
    );
    expect(clientSpan.attributes['gen_ai.tool.call.result']).toBeUndefined();
    expect(JSON.stringify(clientSpan)).not.toContain('secret');
  });

  it('keeps no message line in the stack, even one shaped like a frame', () => {
    const error = new Error(
      'card declined\n    at 4111-1111 (customer.ts:1:1)',
    );
    const recorded = recordableError({}, error, 'charge') as Error;
    expect(recorded.stack).toBeUndefined();
  });

  it('drops cached stacks after the message is shortened', () => {
    const error = new Error(
      'card declined\n    at 4111-1111 (customer.ts:1:1)',
    );
    expect(error.stack).toContain('4111');
    error.message = 'card declined';

    const recorded = recordableError({}, error, 'charge') as Error;
    expect(recorded.stack).toBeUndefined();
  });

  it('redacts a thrown failure once: a stateful redactor cannot give a second answer', async () => {
    let calls = 0;
    await call(
      await v2(
        {
          captureErrorMessages: true,
          redact: (text, info) => {
            if (info.kind !== 'error') return text;
            if (calls++ === 0) throw new Error('first call fails');
            return text;
          },
        },
        failing,
      ),
    );
    expect(JSON.stringify(span('charge')[0])).not.toContain('4111');
  });

  it('records an error whose stack is not a string, and rethrows the original', () => {
    const error = new Error('card 4111 declined');
    Object.defineProperty(error, 'stack', { value: { frames: [] } });
    const recorded = recordableError({}, error, 'charge') as Error;
    expect(recorded).toBeInstanceOf(Error);
    expect(recorded.stack).toBeUndefined();
    expect(() => rethrowOriginal(thrownInSpan(error, recorded))).toThrow(error);
  });

  it('gives the client’s isError status its text with captureErrorMessages, through redact', async () => {
    const server = instrumentMcpServer(
      new McpServer({ name: 't', version: '1.0.0' }),
      {},
    );
    failing(server);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = instrumentMcpClient(
      new Client({ name: 'c', version: '1.0.0' }),
      {
        captureErrorMessages: true,
        redact: (text) => text.replaceAll(/\d{4}-\d{4}/g, '[card]'),
      },
    );
    await client.connect(clientSide);
    await client.callTool({ name: 'refund', arguments: { card: '4111-1111' } });
    const clientSpan = span('refund').find((s) => s.kind === 2)!;
    expect(clientSpan.status.message).toBe('refund to [card] failed');
  });

  it('rethrows a falsy rejection as it was', () => {
    for (const value of [undefined, null, false, 0, '']) {
      const thrown = thrownInSpan(value, recordableError({}, value, 'x'));
      let caught: unknown = 'not thrown';
      try {
        rethrowOriginal(thrown);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(value);
    }
  });
});

describe('resolveOriginalTool', () => {
  /** A low-level server whose `notes` tool declares `context` for some callers only. */
  async function lowLevel(withResolver: boolean) {
    let ownsContext = false;
    const received: unknown[] = [];
    const tool = () => ({
      name: 'notes',
      inputSchema: {
        type: 'object' as const,
        properties: {
          q: { type: 'string' },
          ...(ownsContext ? { context: { type: 'string' } } : {}),
        },
        additionalProperties: false,
      },
    });
    const server = instrumentMcpServer(
      new ServerV1(
        { name: 't', version: '1.0.0' },
        { capabilities: { tools: {} } },
      ),
      {
        captureIntent: true,
        // The caller's own definition, as the server builds it for them.
        ...(withResolver && { resolveOriginalTool: () => tool() }),
      },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [tool()],
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      received.push(request.params.arguments);
      return { content: [] };
    });
    const [clientSide, serverSide] = InMemoryTransportV1.createLinkedPair();
    await server.connect(serverSide);
    const client = new ClientV1({ name: 'c', version: '1.0.0' });
    await client.connect(clientSide);
    // One caller lists the tool without its own `context`: ours is injected.
    await client.listTools();
    ownsContext = true;
    await client.callTool({
      name: 'notes',
      arguments: { q: 'x', context: 'the tool’s own value' },
    });
    return received;
  }

  it('strips by the last listing without one: a caller-dependent schema loses its own field', async () => {
    expect(await lowLevel(false)).toEqual([{ q: 'x' }]);
  });

  it('leaves get_more_tools to the server’s handler when the resolver throws', async () => {
    const server = instrumentMcpServer(
      new ServerV1(
        { name: 't', version: '1.0.0' },
        { capabilities: { tools: {} } },
      ),
      {
        reportMissingTools: true,
        resolveOriginalTool: () => {
          throw new Error('lookup failed');
        },
      },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'get_more_tools',
          inputSchema: { type: 'object' as const, properties: {} },
        },
      ],
    }));
    server.setRequestHandler(CallToolRequestSchema, async () => ({
      content: [{ type: 'text', text: 'the server’s own' }],
    }));
    const [clientSide, serverSide] = InMemoryTransportV1.createLinkedPair();
    await server.connect(serverSide);
    const client = new ClientV1({ name: 'c', version: '1.0.0' });
    await client.connect(clientSide);
    await client.listTools();
    const result = await client.callTool({
      name: 'get_more_tools',
      arguments: {},
    });
    expect(texts(result)).toEqual(['the server’s own']);
  });

  it('keeps the built-in get_more_tools fields when the resolver knows no such tool', async () => {
    const server = instrumentMcpServer(
      new ServerV1(
        { name: 't', version: '1.0.0' },
        { capabilities: { tools: {} } },
      ),
      {
        sessionHandles: true,
        reportMissingTools: true,
        resolveOriginalTool: () => null,
      },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{ name: 'notes', inputSchema: { type: 'object' as const } }],
    }));
    server.setRequestHandler(CallToolRequestSchema, async () => ({
      content: [],
    }));
    const [clientSide, serverSide] = InMemoryTransportV1.createLinkedPair();
    await server.connect(serverSide);
    const client = new ClientV1({ name: 'c', version: '1.0.0' });
    await client.connect(clientSide);
    await client.listTools();
    await client.callTool({ name: 'get_more_tools', arguments: {} });
    expect(
      span('get_more_tools')[0]!.attributes['mcp.session_handle.source'],
    ).toBe('minted');
  });

  it('strips by the caller’s own schema with one', async () => {
    expect(await lowLevel(true)).toEqual([
      { q: 'x', context: 'the tool’s own value' },
    ]);
  });
});

describe('client identity on stateless HTTP', () => {
  it('round-trips a reported name and version, and rejects anything else', () => {
    const id = encodeClientIdentity({ name: 'claude-code', version: '2.1.0' })!;
    expect(id).toMatch(/^mcpci1\.[\w-]+$/);
    expect(decodeClientIdentity(id)).toEqual({
      name: 'claude-code',
      version: '2.1.0',
    });
    expect(decodeClientIdentity('a-native-session-id')).toBeUndefined();
    expect(decodeClientIdentity('mcpci1.!!!')).toBeUndefined();
    expect(encodeClientIdentity({ version: '1' })).toBeUndefined();
  });

  let server: http.Server | undefined;
  afterEach(
    () =>
      new Promise<void>((done) =>
        server ? server.close(() => done()) : done(),
      ),
  );

  async function statelessServer(
    config: McpInstrumentationConfig,
    headers?: Record<string, string>,
    enableJsonResponse = true,
  ) {
    server = http.createServer(async (req, res) => {
      // Stateless: a fresh server and transport for every request.
      const mcp = instrumentMcpServer(
        new McpServerV1({ name: 'lunch-tools', version: '1.0.0' }),
        config,
      );
      mcp.registerTool('get_menu', {}, async () => ({
        content: [{ type: 'text', text: 'mezze' }],
      }));
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse,
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res);
    });
    await new Promise<void>((done) => server!.listen(0, done));
    const { port } = server!.address() as AddressInfo;
    const client = new ClientV1({ name: 'claude-code', version: '2.1.0' });
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${port}/mcp`),
        headers && { requestInit: { headers } },
      ),
    );
    await client.callTool({ name: 'get_menu', arguments: {} });
    await client.close();
    return span('get_menu')[0]!.attributes;
  }

  it('names the client on a later request to a fresh stateless server', async () => {
    const attributes = await statelessServer({});
    expect(attributes).toMatchObject({
      'mcp.client.name': 'claude-code',
      'mcp.client.version': '2.1.0',
    });
    // An identity header is not a session.
    expect(attributes['mcp.session.id']).toBeUndefined();
  });

  it('names it when the initialize answer is a stream', async () => {
    const attributes = await statelessServer({}, undefined, false);
    expect(attributes['mcp.client.name']).toBe('claude-code');
  });

  it('cannot name it with the option off', async () => {
    const attributes = await statelessServer({
      statelessClientIdentity: false,
    });
    expect(attributes['mcp.client.name']).toBeUndefined();
  });

  it('reads no identity header with the option off', async () => {
    const attributes = await statelessServer(
      { statelessClientIdentity: false },
      {
        'mcp-session-id': encodeClientIdentity({
          name: 'forged',
          version: '1',
        })!,
      },
    );
    expect(attributes['mcp.client.name']).toBeUndefined();
  });
});
