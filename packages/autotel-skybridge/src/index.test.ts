import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { context, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createStructuredError } from 'autotel';
import { instrumentMcpClient } from 'autotel-mcp-instrumentation';
import { Skybridge } from 'skybridge/server';
import { z } from 'zod';
import { skybridgeTracing, type McpInstrumentationConfig } from './index';

const exporter = new InMemorySpanExporter();

beforeAll(() => {
  context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable(),
  );
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  const provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
});

afterEach(() => exporter.reset());

async function connect(config?: McpInstrumentationConfig) {
  const app = new Skybridge({
    name: 'test',
    version: '1.0.0',
    handler: (server) => {
      server.registerResource(
        'config',
        'config://app?v=abc123',
        { mimeType: 'text/plain' },
        async (uri) => ({ contents: [{ uri: uri.href, text: 'ok' }] }),
      );
      server.registerPrompt('summarise', { description: 'Summarise' }, () => ({
        messages: [{ role: 'user', content: { type: 'text', text: 'hi' } }],
      }));
      return server
        .registerTool(
          {
            name: 'greet',
            description: 'Greet someone',
            inputSchema: { name: z.string() },
          },
          async ({ name }) => {
            // A span the tool itself starts must nest under the server span.
            trace.getTracer('tool').startSpan('inner').end();
            return { content: [{ type: 'text', text: `hi ${name}` }] };
          },
        )
        .registerTool({ name: 'boom', description: 'Throws' }, async () => {
          throw new Error('kaboom');
        })
        .registerTool(
          { name: 'structured', description: 'Throws a structured error' },
          async () => {
            throw createStructuredError({
              message: 'Card declined',
              why: 'Issuer refused',
              fix: 'Use another card',
              code: 'CARD_DECLINED',
            });
          },
        )
        .mcpMiddleware(skybridgeTracing(config));
    },
  });

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const instance = await app.createServerInstance();
  await instance.connect(serverTransport);
  const client = instrumentMcpClient(
    new Client({ name: 'test-client', version: '1.0.0' }),
  );
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await instance.close();
    },
  };
}

const spanNamed = (name: string) => {
  const span = exporter.getFinishedSpans().find((s) => s.name === name);
  expect(span, `span "${name}"`).toBeDefined();
  return span!;
};

describe('skybridgeTracing', () => {
  it('traces a tool call as a child of the client span', async () => {
    const { client, close } = await connect({ captureToolArgs: true });
    const result = await client.callTool({
      name: 'greet',
      arguments: { name: 'World' },
    });
    await close();

    expect(result.content).toEqual([{ type: 'text', text: 'hi World' }]);

    const server = spanNamed('tools/call greet');
    expect(server.attributes).toMatchObject({
      'mcp.method.name': 'tools/call',
      'gen_ai.tool.name': 'greet',
      'gen_ai.tool.call.arguments': '{"name":"World"}',
    });
    expect(server.status.code).toBe(1); // OK

    const clientSpans = exporter
      .getFinishedSpans()
      .filter((s) => s.name === 'tools/call greet' && s !== server);
    expect(clientSpans).toHaveLength(1);
    expect(server.spanContext().traceId).toBe(
      clientSpans[0]!.spanContext().traceId,
    );
    expect(server.parentSpanContext?.spanId).toBe(
      clientSpans[0]!.spanContext().spanId,
    );

    expect(spanNamed('inner').parentSpanContext?.spanId).toBe(
      server.spanContext().spanId,
    );
  });

  it('records the thrown error behind an isError result', async () => {
    const { client, close } = await connect();
    const result = await client.callTool({ name: 'boom', arguments: {} });
    await close();

    expect(result.isError).toBe(true);
    const server = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'tools/call boom' && s.kind === 1); // SERVER
    expect(server?.status.code).toBe(2); // ERROR
    expect(server?.status.message).toContain('kaboom');
    expect(server?.attributes['error.type']).toBe('tool_error');
    const exceptions = server?.events.filter((e) => e.name === 'exception');
    expect(exceptions).toHaveLength(1);
    expect(exceptions?.[0]?.attributes?.['exception.message']).toBe('kaboom');
  });

  it("keeps a structured error's fields as error.* attributes", async () => {
    const { client, close } = await connect();
    await client.callTool({ name: 'structured', arguments: {} });
    await close();

    const server = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'tools/call structured' && s.kind === 1); // SERVER
    expect(server?.attributes).toMatchObject({
      'error.why': 'Issuer refused',
      'error.fix': 'Use another card',
      'error.code': 'CARD_DECLINED',
      // The isError verdict still wins over the thrown error's name.
      'error.type': 'tool_error',
    });
  });

  it('records no exception when captureErrors is false', async () => {
    const { client, close } = await connect({ captureErrors: false });
    await client.callTool({ name: 'boom', arguments: {} });
    await close();

    const server = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'tools/call boom' && s.kind === 1); // SERVER
    expect(server?.status.code).toBe(2); // ERROR
    expect(server?.events.filter((e) => e.name === 'exception')).toHaveLength(
      0,
    );
  });

  it('traces a resource read without the cache-key query', async () => {
    const { client, close } = await connect();
    await client.readResource({ uri: 'config://app?v=abc123' });
    await close();

    const server = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'resources/read' && s.kind === 1); // SERVER
    expect(server?.attributes['mcp.resource.uri']).toBe('config://app');
  });

  it('traces a prompt', async () => {
    const { client, close } = await connect();
    await client.getPrompt({ name: 'summarise' });
    await close();

    const server = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'prompts/get summarise' && s.kind === 1); // SERVER
    expect(server?.attributes['gen_ai.prompt.name']).toBe('summarise');
  });

  it('names an unknown tool call after the method only', async () => {
    const { client, close } = await connect();
    await expect(
      client.callTool({ name: 'nope-123', arguments: {} }),
    ).rejects.toThrow();
    await close();

    const servers = exporter.getFinishedSpans().filter((s) => s.kind === 1); // SERVER
    expect(servers.map((s) => s.name)).toEqual(['tools/call']);
  });

  it('leaves untraced methods alone', async () => {
    const { client, close } = await connect();
    await client.listTools();
    await close();

    expect(
      exporter.getFinishedSpans().filter((s) => s.kind === 1), // SERVER
    ).toHaveLength(0);
  });
});
