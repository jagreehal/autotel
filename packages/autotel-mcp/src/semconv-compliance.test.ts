import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MCP_DURATION_BUCKETS, MCP_SEMCONV } from './semantic-conventions';

const hoisted = vi.hoisted(() => ({
  traceCalls: [] as Array<{ options: unknown; ctx: any }>,
  clientMetricAttrs: [] as Array<Record<string, unknown>>,
  serverMetricAttrs: [] as Array<Record<string, unknown>>,
}));

vi.mock('@opentelemetry/api', () => ({
  SpanStatusCode: {
    OK: 1,
    ERROR: 2,
  },
  context: {
    with: (_ctx: unknown, fn: () => unknown) => fn(),
  },
}));

vi.mock('autotel', () => ({
  SpanKind: {
    CLIENT: 'client',
    SERVER: 'server',
  },
  trace: async (options: unknown, fn: (ctx: any) => unknown) => {
    const ctx = {
      setAttribute: vi.fn(),
      setAttributes: vi.fn(),
      setStatus: vi.fn(),
      recordException: vi.fn(),
    };
    hoisted.traceCalls.push({ options, ctx });
    return await fn(ctx);
  },
}));

vi.mock('./context', () => ({
  injectOtelContextToMeta: () => ({
    traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
  }),
  extractOtelContextFromMeta: () => ({}),
}));

vi.mock('./metrics', () => ({
  recordClientOperationDuration: (
    _durationS: number,
    attrs: Record<string, unknown>,
  ) => {
    hoisted.clientMetricAttrs.push(attrs);
  },
  recordServerOperationDuration: (
    _durationS: number,
    attrs: Record<string, unknown>,
  ) => {
    hoisted.serverMetricAttrs.push(attrs);
  },
}));

describe('MCP semconv compliance', () => {
  beforeEach(() => {
    hoisted.traceCalls.length = 0;
    hoisted.clientMetricAttrs.length = 0;
    hoisted.serverMetricAttrs.length = 0;
  });

  it('uses spec-recommended duration buckets starting at 10ms', () => {
    expect(MCP_DURATION_BUCKETS[0]).toBe(0.01);
  });

  it('records tool name in client operation duration metric attributes', async () => {
    const { instrumentMcpClient } = await import('./client');

    const client = {
      callTool: vi.fn(async () => ({ content: [] })),
    };

    const instrumented = instrumentMcpClient(client, {
      enableMetrics: true,
    });

    await instrumented.callTool({
      name: 'get_weather',
      arguments: { location: 'New York' },
    });

    expect(hoisted.clientMetricAttrs[0][MCP_SEMCONV.METHOD_NAME]).toBe(
      'tools/call',
    );
    expect(hoisted.clientMetricAttrs[0][MCP_SEMCONV.TOOL_NAME]).toBe(
      'get_weather',
    );
  });

  it('sets mcp.resource.uri to the registered resource URI on server spans', async () => {
    const { instrumentMcpServer } = await import('./server');

    let wrappedRead: ((...args: unknown[]) => Promise<unknown>) | undefined;
    const server = {
      registerResource: vi.fn(
        (
          _name: string,
          _uriOrTemplate: unknown,
          _config: unknown,
          readCallback: (...args: unknown[]) => Promise<unknown>,
        ) => {
          wrappedRead = readCallback;
        },
      ),
    };

    const instrumented = instrumentMcpServer(server);
    instrumented.registerResource(
      'weather_config',
      'weather://config',
      {},
      async () => ({ contents: [] }),
    );

    await wrappedRead?.({});

    const resourceSpanCall = hoisted.traceCalls.at(-1);
    expect(resourceSpanCall).toBeDefined();
    expect(resourceSpanCall?.ctx.setAttribute).toHaveBeenCalledWith(
      MCP_SEMCONV.RESOURCE_URI,
      'weather://config',
    );
  });

  it('does not include resource URI in client span name by default', async () => {
    const { instrumentMcpClient } = await import('./client');

    const client = {
      readResource: vi.fn(async () => ({ contents: [] })),
    };

    const instrumented = instrumentMcpClient(client);
    await instrumented.readResource({ uri: 'weather://config' });

    const resourceSpanCall = hoisted.traceCalls.at(-1);
    expect(resourceSpanCall?.options).toMatchObject({
      name: 'resources/read',
    });
  });

  it('does not include resource URI in server span name by default', async () => {
    const { instrumentMcpServer } = await import('./server');

    let wrappedRead: ((...args: unknown[]) => Promise<unknown>) | undefined;
    const server = {
      registerResource: vi.fn(
        (
          _name: string,
          _uriOrTemplate: unknown,
          _config: unknown,
          readCallback: (...args: unknown[]) => Promise<unknown>,
        ) => {
          wrappedRead = readCallback;
        },
      ),
    };

    const instrumented = instrumentMcpServer(server);
    instrumented.registerResource(
      'weather_config',
      'weather://config',
      {},
      async () => ({ contents: [] }),
    );

    await wrappedRead?.({});

    const resourceSpanCall = hoisted.traceCalls.at(-1);
    expect(resourceSpanCall?.options).toMatchObject({
      name: 'resources/read',
    });
  });

  it('records resource URI on client resource/read duration metrics', async () => {
    const { instrumentMcpClient } = await import('./client');

    const client = {
      readResource: vi.fn(async () => ({ contents: [] })),
    };

    const instrumented = instrumentMcpClient(client, {
      enableMetrics: true,
    });

    await instrumented.readResource({ uri: 'weather://config' });

    expect(hoisted.clientMetricAttrs[0][MCP_SEMCONV.METHOD_NAME]).toBe(
      'resources/read',
    );
    expect(hoisted.clientMetricAttrs[0][MCP_SEMCONV.RESOURCE_URI]).toBe(
      'weather://config',
    );
  });

  it('records tool name on server tools/call duration metrics', async () => {
    const { instrumentMcpServer } = await import('./server');

    let wrappedTool: ((...args: unknown[]) => Promise<unknown>) | undefined;
    const server = {
      registerTool: vi.fn(
        (
          _name: string,
          _config: unknown,
          toolHandler: (...args: unknown[]) => Promise<unknown>,
        ) => {
          wrappedTool = toolHandler;
        },
      ),
    };

    const instrumented = instrumentMcpServer(server, {
      enableMetrics: true,
    });
    instrumented.registerTool('get_weather', {}, async () => ({ content: [] }));
    await wrappedTool?.({ location: 'New York' });

    expect(hoisted.serverMetricAttrs[0][MCP_SEMCONV.METHOD_NAME]).toBe(
      'tools/call',
    );
    expect(hoisted.serverMetricAttrs[0][MCP_SEMCONV.TOOL_NAME]).toBe(
      'get_weather',
    );
  });

  it('records prompt name on client prompts/get duration metrics', async () => {
    const { instrumentMcpClient } = await import('./client');

    const client = {
      getPrompt: vi.fn(async () => ({ messages: [] })),
    };

    const instrumented = instrumentMcpClient(client, {
      enableMetrics: true,
    });
    await instrumented.getPrompt({ name: 'weather_report', arguments: {} });

    expect(hoisted.clientMetricAttrs[0][MCP_SEMCONV.METHOD_NAME]).toBe(
      'prompts/get',
    );
    expect(hoisted.clientMetricAttrs[0][MCP_SEMCONV.PROMPT_NAME]).toBe(
      'weather_report',
    );
  });

  it('records tool name on server tools/call duration metrics when handler throws', async () => {
    const { instrumentMcpServer } = await import('./server');

    let wrappedTool: ((...args: unknown[]) => Promise<unknown>) | undefined;
    const server = {
      registerTool: vi.fn(
        (
          _name: string,
          _config: unknown,
          toolHandler: (...args: unknown[]) => Promise<unknown>,
        ) => {
          wrappedTool = toolHandler;
        },
      ),
    };

    const instrumented = instrumentMcpServer(server, {
      enableMetrics: true,
    });
    instrumented.registerTool('get_weather', {}, async () => {
      throw new Error('boom');
    });

    await expect(wrappedTool?.({ location: 'New York' })).rejects.toThrow(
      'boom',
    );

    expect(hoisted.serverMetricAttrs[0][MCP_SEMCONV.METHOD_NAME]).toBe(
      'tools/call',
    );
    expect(hoisted.serverMetricAttrs[0][MCP_SEMCONV.TOOL_NAME]).toBe(
      'get_weather',
    );
  });
});
