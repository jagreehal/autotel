/**
 * Against the real SDKs: the low-level `Server` API traced like a registered
 * tool, client identity on server spans, agent-reported model, selected
 * existing arguments, and schemas that take any argument name left alone.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createTraceCollector, type TraceCollector } from 'autotel/testing';
import { z } from 'zod';
import {
  InMemoryTransport,
  McpServer,
  Server,
} from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import { Server as ServerV1 } from '@modelcontextprotocol/sdk/server/index.js';
import { Client as ClientV1 } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport as InMemoryTransportV1 } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { instrumentMcpServer } from './server';
import type { McpInstrumentationConfig } from './types';

let collector: TraceCollector;
beforeEach(() => {
  collector = createTraceCollector();
});

const toolSpans = (name: string) =>
  collector.getSpansByName(`tools/call ${name}`);

const MENU_TOOL = {
  name: 'get_menu',
  description: "Get a restaurant's catering menu.",
  inputSchema: {
    type: 'object' as const,
    properties: { restaurant: { type: 'string' } },
    required: ['restaurant'],
    additionalProperties: false,
  },
};

describe('low-level Server API', () => {
  it('traces a 2025-era Server tool call, with the client it came from', async () => {
    const received: unknown[] = [];
    const server = instrumentMcpServer(
      new ServerV1(
        { name: 'lunch-tools', version: '1.0.0' },
        { capabilities: { tools: {} } },
      ),
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [MENU_TOOL],
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      received.push(request.params.arguments);
      return { content: [{ type: 'text', text: 'mezze platters' }] };
    });
    const [clientSide, serverSide] = InMemoryTransportV1.createLinkedPair();
    await server.connect(serverSide);
    const client = new ClientV1({ name: 'claude-code', version: '2.1.0' });
    await client.connect(clientSide);

    const result = await client.callTool({
      name: 'get_menu',
      arguments: { restaurant: 'Olive & Thyme' },
    });
    expect(result.content).toEqual([{ type: 'text', text: 'mezze platters' }]);
    expect(received).toEqual([{ restaurant: 'Olive & Thyme' }]);
    const spans = toolSpans('get_menu');
    expect(spans).toHaveLength(1);
    expect(spans[0]!.attributes).toMatchObject({
      'gen_ai.tool.name': 'get_menu',
      'mcp.method.name': 'tools/call',
      'mcp.client.name': 'claude-code',
      'mcp.client.version': '2.1.0',
    });
  });

  it('traces a 2026-07-28 Server tool call once, under task handles too', async () => {
    const received: unknown[] = [];
    const server = instrumentMcpServer(
      new Server(
        { name: 'lunch-tools', version: '1.0.0' },
        { capabilities: { tools: {} } },
      ),
      { captureIntent: true },
    );
    server.setRequestHandler('tools/list', async () => ({
      tools: [MENU_TOOL],
    }));
    server.setRequestHandler('tools/call', async (request) => {
      received.push(request.params.arguments);
      return { content: [{ type: 'text', text: 'mezze platters' }] };
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: 'cursor', version: '3.0.0' });
    await client.connect(clientSide);

    const { tools } = await client.listTools();
    expect(tools[0]!.inputSchema.required).toContain('context');
    await client.callTool({
      name: 'get_menu',
      arguments: {
        restaurant: 'Olive & Thyme',
        context: 'Ordering lunch for the team offsite on Friday afternoon.',
      },
    });
    // The handler sees only its own arguments.
    expect(received).toEqual([{ restaurant: 'Olive & Thyme' }]);
    const spans = toolSpans('get_menu');
    expect(spans).toHaveLength(1);
    expect(spans[0]!.attributes).toMatchObject({
      'mcp.tool.call.intent':
        'Ordering lunch for the team offsite on Friday afternoon.',
      'mcp.client.name': 'cursor',
      'mcp.client.version': '3.0.0',
    });
  });

  it('records a handler that throws as a failed tool span', async () => {
    const server = instrumentMcpServer(
      new ServerV1(
        { name: 'lunch-tools', version: '1.0.0' },
        { capabilities: { tools: {} } },
      ),
    );
    server.setRequestHandler(CallToolRequestSchema, async () => {
      throw new Error('kitchen closed');
    });
    const [clientSide, serverSide] = InMemoryTransportV1.createLinkedPair();
    await server.connect(serverSide);
    const client = new ClientV1({ name: 'c', version: '1.0.0' });
    await client.connect(clientSide);
    await client
      .callTool({ name: 'get_menu', arguments: { restaurant: 'x' } })
      .catch(() => {});
    const [span] = toolSpans('get_menu');
    expect(span!.status.code).toBe(2); // ERROR
    expect(span!.attributes['error.type']).toBe('Error');
  });
});

async function v2(
  config: McpInstrumentationConfig,
  register: (server: McpServer, received: unknown[]) => void,
) {
  const received: unknown[] = [];
  const server = instrumentMcpServer(
    new McpServer({ name: 't', version: '1.0.0' }),
    config,
  );
  register(server, received);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'c', version: '1.0.0' });
  await client.connect(clientSide);
  return { client, received };
}

describe('agent-reported fields', () => {
  const echo = (server: McpServer, received: unknown[]) =>
    server.registerTool(
      'echo',
      { inputSchema: z.strictObject({ msg: z.string() }) },
      async (args: { msg: string }) => {
        received.push(args);
        return { content: [{ type: 'text', text: args.msg }] };
      },
    );

  it('asks for the model and records it, stripped before the handler', async () => {
    const { client, received } = await v2({ captureModel: true }, echo);
    const { tools } = await client.listTools();
    expect(tools[0]!.inputSchema.required).toContain('agent_model');
    await client.callTool({
      name: 'echo',
      arguments: { msg: 'hi', agent_model: 'claude-opus-5-5' },
    });
    expect(received).toEqual([{ msg: 'hi' }]);
    expect(toolSpans('echo')[0]!.attributes['mcp.agent.model']).toBe(
      'claude-opus-5-5',
    );
  });

  it("reads a tool's own field when selected, and leaves it for the handler", async () => {
    const { client, received } = await v2(
      { captureIntent: { argument: 'reason' } },
      (server, got) =>
        server.registerTool(
          'refund',
          {
            inputSchema: z.strictObject({
              order: z.string(),
              reason: z.string(),
            }),
          },
          async (args: { order: string; reason: string }) => {
            got.push(args);
            return { content: [{ type: 'text', text: 'ok' }] };
          },
        ),
    );
    const { tools } = await client.listTools();
    // The tool already declares it: its schema is unchanged.
    expect(Object.keys(tools[0]!.inputSchema.properties ?? {})).toEqual([
      'order',
      'reason',
    ]);
    await client.callTool({
      name: 'refund',
      arguments: { order: 'o-1', reason: 'Arrived cold' },
    });
    expect(received).toEqual([{ order: 'o-1', reason: 'Arrived cold' }]);
    expect(toolSpans('refund')[0]!.attributes['mcp.tool.call.intent']).toBe(
      'Arrived cold',
    );
  });

  it("never reads a tool's own field nobody selected", async () => {
    const { client } = await v2({ captureIntent: true }, (server, got) =>
      server.registerTool(
        'note',
        { inputSchema: z.strictObject({ context: z.string() }) },
        async (args: { context: string }) => {
          got.push(args);
          return { content: [] };
        },
      ),
    );
    await client.listTools();
    await client.callTool({
      name: 'note',
      arguments: { context: 'customer text' },
    });
    expect(
      toolSpans('note')[0]!.attributes['mcp.tool.call.intent'],
    ).toBeUndefined();
  });

  it('takes the session from a selected conversation argument', async () => {
    const { client, received } = await v2(
      { sessionHandles: { argument: 'conversation_id' } },
      (server, got) =>
        server.registerTool(
          'ask',
          {
            inputSchema: z.strictObject({
              q: z.string(),
              conversation_id: z.string(),
            }),
          },
          async (args: { q: string; conversation_id: string }) => {
            got.push(args);
            return { content: [{ type: 'text', text: 'ok' }] };
          },
        ),
    );
    const { tools } = await client.listTools();
    expect(tools[0]!.inputSchema.properties).not.toHaveProperty('session_id');
    await client.callTool({
      name: 'ask',
      arguments: { q: 'menu?', conversation_id: 'app-conv-9' },
    });
    expect(received).toEqual([{ q: 'menu?', conversation_id: 'app-conv-9' }]);
    expect(toolSpans('ask')[0]!.attributes).toMatchObject({
      'gen_ai.conversation.id': 'app-conv-9',
      'mcp.session_handle.source': 'argument',
    });
  });

  it('leaves a schema that takes any argument name alone', async () => {
    const { client, received } = await v2(
      { captureIntent: true, sessionHandles: true },
      (server, got) =>
        server.registerTool(
          'kv',
          { inputSchema: z.object({}).catchall(z.string()) },
          async (args: Record<string, string>) => {
            got.push(args);
            return { content: [] };
          },
        ),
    );
    const { tools } = await client.listTools();
    expect(tools[0]!.inputSchema.properties ?? {}).toEqual({});
    await client.callTool({
      name: 'kv',
      arguments: { context: 'a stored value', session_id: 'mine' },
    });
    // Nothing stripped: both keys are the tool's own data.
    expect(received).toEqual([
      { context: 'a stored value', session_id: 'mine' },
    ]);
  });
});
