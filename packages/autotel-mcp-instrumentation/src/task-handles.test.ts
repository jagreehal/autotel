/**
 * Task handles against the real SDKs, end to end: a client lists tools, calls
 * them through an in-memory transport, and the spans are read back.
 *
 * The tool schema is strict on purpose. Zod rejects unknown keys there, so a
 * call only succeeds if the injected parameters were removed at the request,
 * before the SDK validated it — which is the reason this lives on the
 * request-handler map at all.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createTraceCollector, type TraceCollector } from 'autotel/testing';
import { z } from 'zod';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import { McpServer as McpServerV1 } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client as ClientV1 } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport as InMemoryTransportV1 } from '@modelcontextprotocol/sdk/inMemory.js';
import { instrumentMcpServer } from './server';
import type { McpInstrumentationConfig } from './types';

let collector: TraceCollector;
beforeEach(() => {
  collector = createTraceCollector();
});

const toolSpans = (name: string) =>
  collector.getSpansByName(`tools/call ${name}`);

type Text = { type: string; text?: string };
const texts = (result: unknown) =>
  ((result as { content?: Text[] }).content ?? []).map((c) => c.text ?? '');

async function v2(config: McpInstrumentationConfig) {
  const received: unknown[] = [];
  const server = instrumentMcpServer(
    new McpServer({ name: 't', version: '1.0.0' }),
    config,
  );
  server.registerTool(
    'echo',
    {
      description: 'Echo a message',
      inputSchema: z.strictObject({ msg: z.string() }),
      outputSchema: z.object({ msg: z.string() }),
    },
    async (args: { msg: string }) => {
      received.push(args);
      return {
        content: [{ type: 'text', text: args.msg }],
        structuredContent: { msg: args.msg },
      };
    },
  );
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'c', version: '1.0.0' });
  await client.connect(clientSide);
  return { client, received };
}

describe('session handles (MCP 2026-07-28 SDK)', () => {
  it('changes nothing unless asked', async () => {
    const { client } = await v2({});
    const { tools } = await client.listTools();
    expect(Object.keys(tools[0]!.inputSchema.properties ?? {})).toEqual([
      'msg',
    ]);
  });

  it('issues a session on the first call and correlates the next ones', async () => {
    const { client, received } = await v2({ sessionHandles: true });
    const { tools } = await client.listTools();
    expect(tools[0]!.inputSchema.required).toContain('session_id');

    const first = await client.callTool({
      name: 'echo',
      arguments: { msg: 'hi', session_id: 'start' },
    });
    // The handler saw only its own arguments, and a strict schema accepted them.
    expect(received).toEqual([{ msg: 'hi' }]);
    const issued = /session_id: (ses_[0-9a-f]{32})/.exec(texts(first)[0]!)?.[1];
    expect(issued).toBeDefined();
    expect(texts(first)[1]).toBe('hi');
    expect(
      (first.structuredContent as Record<string, unknown>).mcp_session,
    ).toEqual({ session_id: issued, status: 'issued' });

    await client.callTool({
      name: 'echo',
      arguments: { msg: 'again', session_id: issued },
    });
    const spans = toolSpans('echo');
    expect(spans.map((s) => s.attributes['gen_ai.conversation.id'])).toEqual([
      issued,
      issued,
    ]);
    expect(spans.map((s) => s.attributes['mcp.session_handle.source'])).toEqual(
      ['minted', 'supplied'],
    );
  });

  it('refuses a session id it did not issue', async () => {
    const { client } = await v2({ sessionHandles: true });
    await client.listTools();
    const result = await client.callTool({
      name: 'echo',
      arguments: { msg: 'x', session_id: 'ses_made_up' },
    });
    expect(texts(result)[0]).toContain('[session_id unrecognized');
    const [span] = toolSpans('echo');
    expect(span!.attributes['gen_ai.conversation.id']).toBeUndefined();
    expect(span!.attributes['mcp.session_handle.source']).toBe('invalid');
  });

  it('records agent id and intent, and answers get_more_tools', async () => {
    const { client } = await v2({
      sessionHandles: { agentId: true },
      captureIntent: true,
      reportMissingTools: true,
      identify: () => 'user-42',
    });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('get_more_tools');

    await client.callTool({
      name: 'echo',
      arguments: {
        msg: 'x',
        session_id: 'start',
        agent_id: 'opus|claude-code|k3n9x',
        context: 'Checking the echo tool before a demo for the team.',
      },
    });
    const [span] = toolSpans('echo');
    expect(span!.attributes).toMatchObject({
      'gen_ai.agent.id': 'opus|claude-code|k3n9x',
      'mcp.tool.call.intent':
        'Checking the echo tool before a demo for the team.',
      'user.id': 'user-42',
    });

    const reply = await client.callTool({
      name: 'get_more_tools',
      arguments: { context: 'Needs a tool that deletes messages.' },
    });
    expect(texts(reply).join('\n')).toContain('full tool list');
    const [missing] = toolSpans('get_more_tools');
    expect(missing!.attributes['mcp.missing_tool.description']).toBe(
      'Needs a tool that deletes messages.',
    );
  });

  it('derives the session from a resolver and leaves schemas alone', async () => {
    const { client } = await v2({
      sessionHandles: { resolveSessionId: () => 'tenant-7:conv-3' },
    });
    const { tools } = await client.listTools();
    expect(tools[0]!.inputSchema.properties).not.toHaveProperty('session_id');
    await client.callTool({ name: 'echo', arguments: { msg: 'x' } });
    expect(toolSpans('echo')[0]!.attributes).toMatchObject({
      'gen_ai.conversation.id': 'tenant-7:conv-3',
      'mcp.session_handle.source': 'hook',
    });
  });
});

describe('per-request servers and owned parameters', () => {
  it('strips correctly on an instance that never served tools/list', async () => {
    // 2026-07-28 builds a server per request: the call lands on a fresh
    // instance, so it rebuilds what the listing instance advertised.
    const { client, received } = await v2({ sessionHandles: true });
    const result = await client.callTool({
      name: 'echo',
      arguments: { msg: 'cold', session_id: 'start' },
    });
    expect(received).toEqual([{ msg: 'cold' }]);
    expect(texts(result)[0]).toContain('[session_id issued');
  });

  it("leaves a tool's own session_id parameter to the tool", async () => {
    const received: unknown[] = [];
    const server = instrumentMcpServer(
      new McpServer({ name: 't', version: '1.0.0' }),
      { sessionHandles: true },
    );
    server.registerTool(
      'resume',
      { inputSchema: z.strictObject({ session_id: z.string() }) },
      async (args: { session_id: string }) => {
        received.push(args);
        return { content: [{ type: 'text', text: 'ok' }] };
      },
    );
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: 'c', version: '1.0.0' });
    await client.connect(clientSide);
    await client.listTools();

    const result = await client.callTool({
      name: 'resume',
      arguments: { session_id: 'their-own-id' },
    });
    expect(received).toEqual([{ session_id: 'their-own-id' }]);
    expect(texts(result)).toEqual(['ok']);
    const [span] = toolSpans('resume');
    expect(span!.attributes['mcp.session_handle.source']).toBe('foreign');
    expect(span!.attributes['gen_ai.conversation.id']).toBeUndefined();
  });
});

describe('only what was injected is touched', () => {
  async function connected(server: ReturnType<typeof instrumentMcpServer>) {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: 'c', version: '1.0.0' });
    await client.connect(clientSide);
    return client;
  }

  it("never strips a tool's own arguments, even for a tool added after the listing", async () => {
    const received: unknown[] = [];
    const server = instrumentMcpServer(
      new McpServer({ name: 't', version: '1.0.0' }),
      { identify: () => 'user-1' }, // no parameters injected at all
    );
    server.registerTool('first', { inputSchema: z.object({}) }, async () => ({
      content: [],
    }));
    const client = await connected(server);
    await client.listTools();
    server.registerTool(
      'late',
      { inputSchema: z.strictObject({ context: z.string() }) },
      async (args: { context: string }) => {
        received.push(args);
        return { content: [{ type: 'text', text: 'ok' }] };
      },
    );
    await client.callTool({
      name: 'late',
      arguments: { context: 'customer value' },
    });
    expect(received).toEqual([{ context: 'customer value' }]);
  });

  it('announces in text only when the output schema cannot take mcp_session', async () => {
    const server = instrumentMcpServer(
      new McpServer({ name: 't', version: '1.0.0' }),
      { sessionHandles: true },
    );
    server.registerTool(
      'composed',
      {
        inputSchema: z.object({}),
        // A union lists as a composed anyOf whose branches are strict: there
        // is no single property bag to declare mcp_session in.
        outputSchema: z.union([
          z.strictObject({ a: z.string() }),
          z.strictObject({ b: z.string() }),
        ]),
      },
      async () => ({
        content: [{ type: 'text', text: 'ok' }],
        structuredContent: { a: '1' },
      }),
    );
    const client = await connected(server);
    await client.listTools();
    // The client validates structuredContent against the listed schema: a
    // stray mcp_session would make this call fail.
    const result = await client.callTool({
      name: 'composed',
      arguments: { session_id: 'start' },
    });
    expect(result.structuredContent).toEqual({ a: '1' });
    expect(texts(result)[0]).toContain('[session_id issued');
  });
});

describe('session handles (2025-era SDK)', () => {
  it('issues and strips the handle the same way', async () => {
    const received: unknown[] = [];
    const server = instrumentMcpServer(
      new McpServerV1({ name: 't', version: '1.0.0' }),
      { sessionHandles: true },
    );
    server.registerTool(
      'echo',
      { inputSchema: { msg: z.string() } },
      async (args: { msg: string }) => {
        received.push(args);
        return { content: [{ type: 'text', text: args.msg }] };
      },
    );
    const [clientSide, serverSide] = InMemoryTransportV1.createLinkedPair();
    await server.connect(serverSide);
    const client = new ClientV1({ name: 'c', version: '1.0.0' });
    await client.connect(clientSide);

    const result = await client.callTool({
      name: 'echo',
      arguments: { msg: 'hi', session_id: 'start' },
    });
    expect(received).toEqual([{ msg: 'hi' }]);
    expect(texts(result)[0]).toContain('[session_id issued');
    expect(toolSpans('echo')[0]!.attributes['mcp.session_handle.source']).toBe(
      'minted',
    );
  });
});
