import { beforeEach, describe, expect, it } from 'vitest';
import { instrumentWebMCP } from './instrument';

interface RecordedSpan {
  name: string;
  attributes: Record<string, string | number | boolean>;
}

let spans: RecordedSpan[];

// Stand-in for autotel-web's `span()`, so these tests need no OTel pipeline.
const recordingSpan = <T>(
  name: string,
  fn: (s: {
    setAttribute: (k: string, v: string | number | boolean) => void;
    end: () => void;
  }) => T,
): T => {
  const entry: RecordedSpan = { name, attributes: {} };
  spans.push(entry);
  return fn({
    setAttribute: (k, v) => {
      entry.attributes[k] = v;
    },
    end: () => {},
  });
};

// Minimal fake of Chrome's behaviour: JSON-string input, serialised output.
function installFakeModelContext() {
  const registry = new Map<string, { tool: Record<string, unknown> }>();
  const mc = {
    async registerTool(tool: Record<string, unknown>) {
      registry.set(tool['name'] as string, { tool });
    },
    async getTools() {
      return [...registry.values()].map(({ tool }) => ({
        name: tool['name'],
        description: tool['description'],
        // Chrome keeps only these two.
        ...(tool['annotations']
          ? {
              annotations: { readOnlyHint: false, untrustedContentHint: false },
            }
          : {}),
      }));
    },
    async executeTool(tool: { name: string }, input: string) {
      const entry = registry.get(tool.name)!;
      const execute = entry.tool['execute'] as (
        i: unknown,
        o: unknown,
      ) => unknown;
      const value = await execute(JSON.parse(input), {
        signal: new AbortController().signal,
      });
      const raw =
        typeof value === 'string' ? value : String(JSON.stringify(value));
      return raw === '' ? 'Operation succeeded' : raw;
    },
  };
  Object.defineProperty(document, 'modelContext', {
    value: mc,
    configurable: true,
    writable: true,
  });
  return mc;
}

describe('instrumentWebMCP', () => {
  beforeEach(() => {
    spans = [];
    installFakeModelContext();
  });

  const register = (over: Record<string, unknown> = {}) =>
    document.modelContext!.registerTool({
      name: 'search',
      description: 'Search the catalogue',
      inputSchema: { type: 'object', properties: {} },
      execute: () => 'ok',
      ...over,
    } as never);

  it('emits a span when a tool is registered', async () => {
    instrumentWebMCP({ span: recordingSpan });
    await register();

    const span = spans.find((s) => s.name === 'webmcp.tool.register');
    expect(span?.attributes['webmcp.tool.name']).toBe('search');
  });

  it('does not reject a successful registration when browser introspection fails', async () => {
    const modelContext = document.modelContext!;
    modelContext.getTools = async () => {
      throw new DOMException(
        'Tool discovery is unavailable',
        'NotAllowedError',
      );
    };
    instrumentWebMCP({ span: recordingSpan });

    await expect(register()).resolves.toBeUndefined();
  });

  it('traces registrations that the browser rejects', async () => {
    document.modelContext!.registerTool = async () => {
      throw new DOMException('Duplicate tool name', 'InvalidStateError');
    };
    instrumentWebMCP({ span: recordingSpan });

    await expect(register()).rejects.toThrow('Duplicate tool name');
    expect(spans.some((span) => span.name === 'webmcp.tool.register')).toBe(
      true,
    );
  });

  it('records annotations the browser dropped', async () => {
    instrumentWebMCP({ span: recordingSpan });
    await register({
      annotations: { readOnlyHint: true, destructiveHint: true },
    });

    const span = spans.find((s) => s.name === 'webmcp.tool.register');
    expect(span?.attributes['webmcp.annotations.dropped']).toBe(
      'destructiveHint',
    );
  });

  it('emits a span for each execution with what the agent received', async () => {
    instrumentWebMCP({ span: recordingSpan, capturePayloads: true });
    await register({ execute: () => 'found 3 items' });
    const [tool] = await document.modelContext!.getTools();
    await document.modelContext!.executeTool(tool as never, '{"q":"x"}');

    const span = spans.find((s) => s.name === 'webmcp.tool.execute');
    expect(span?.attributes).toMatchObject({
      'webmcp.tool.name': 'search',
      'webmcp.result': 'found 3 items',
      'webmcp.result.envelope': false,
      'gen_ai.operation.name': 'execute_tool',
      'gen_ai.tool.name': 'search',
      'gen_ai.tool.call.arguments': '{"q":"x"}',
      'gen_ai.tool.call.result': 'found 3 items',
      'mcp.tool.arguments.size': 9,
      'mcp.tool.result.size': 13,
    });
  });

  it('omits tool payloads unless capture is explicitly enabled', async () => {
    instrumentWebMCP({ span: recordingSpan });
    await register({
      execute: ({ address }: { address: string }) => `shipping to ${address}`,
    });
    const [tool] = await document.modelContext!.getTools();
    await document.modelContext!.executeTool(
      tool as never,
      '{"address":"10 Private Lane"}',
    );

    const span = spans.find((entry) => entry.name === 'webmcp.tool.execute');
    expect(span?.attributes['webmcp.input']).toBeUndefined();
    expect(span?.attributes['webmcp.result']).toBeUndefined();
    expect(JSON.stringify(span?.attributes)).not.toContain('10 Private Lane');
  });

  it('flags an MCP envelope on the execution span', async () => {
    instrumentWebMCP({ span: recordingSpan });
    await register({
      execute: () => ({ content: [{ type: 'text', text: 'hi' }] }),
    });
    const [tool] = await document.modelContext!.getTools();
    await document.modelContext!.executeTool(tool as never, '{}');

    const span = spans.find((s) => s.name === 'webmcp.tool.execute');
    expect(span?.attributes['webmcp.result.envelope']).toBe(true);
  });

  it('records the substitution Chrome makes for an empty result', async () => {
    instrumentWebMCP({ span: recordingSpan });
    await register({ execute: () => '' });
    const [tool] = await document.modelContext!.getTools();
    await document.modelContext!.executeTool(tool as never, '{}');

    const span = spans.find((s) => s.name === 'webmcp.tool.execute');
    expect(span?.attributes['webmcp.result.substituted']).toBe(true);
  });

  it('serialises a stateful result once so telemetry matches what the agent receives', async () => {
    let reads = 0;
    instrumentWebMCP({ span: recordingSpan, capturePayloads: true });
    await register({
      execute: () => ({
        get value() {
          reads += 1;
          return reads;
        },
      }),
    });
    const [tool] = await document.modelContext!.getTools();

    const received = await document.modelContext!.executeTool(
      tool as never,
      '{}',
    );
    const span = spans.find((entry) => entry.name === 'webmcp.tool.execute');

    expect(received).toBe('{"value":1}');
    expect(span?.attributes['webmcp.result']).toBe(received);
    expect(reads).toBe(1);
  });

  it('waits for promise-like tool results before recording them', async () => {
    instrumentWebMCP({ span: recordingSpan, capturePayloads: true });
    await register({
      execute: () => ({
        then: (resolve: (value: string) => void) => resolve('later'),
      }),
    });
    const [tool] = await document.modelContext!.getTools();

    await expect(
      document.modelContext!.executeTool(tool as never, '{}'),
    ).resolves.toBe('later');
    const span = spans.find((entry) => entry.name === 'webmcp.tool.execute');
    expect(span?.attributes['webmcp.result']).toBe('later');
  });

  it('marks application-normalised error results without breaking the agent response', async () => {
    instrumentWebMCP({
      span: recordingSpan,
      isErrorResult: (value) =>
        typeof value === 'string' && value.startsWith('Error: '),
    });
    await register({ execute: () => 'Error: inventory service unavailable' });
    const [tool] = await document.modelContext!.getTools();

    await expect(
      document.modelContext!.executeTool(tool as never, '{}'),
    ).resolves.toBe('Error: inventory service unavailable');
    const span = spans.find((entry) => entry.name === 'webmcp.tool.execute');
    expect(span?.attributes['error.type']).toBe('tool_error');
    expect(span?.attributes['webmcp.result.error']).toBe(true);
  });

  it('does not let a result classifier change a successful tool response', async () => {
    instrumentWebMCP({
      span: recordingSpan,
      isErrorResult: () => {
        throw new Error('classifier failed');
      },
    });
    await register({ execute: () => 'ok' });
    const [tool] = await document.modelContext!.getTools();

    await expect(
      document.modelContext!.executeTool(tool as never, '{}'),
    ).resolves.toBe('ok');
    const span = spans.find((entry) => entry.name === 'webmcp.tool.execute');
    expect(span?.attributes['webmcp.classifier.error.type']).toBe('Error');
  });

  it('leaves the tool working exactly as before', async () => {
    instrumentWebMCP({ span: recordingSpan });
    await register({ execute: ({ q }: { q: string }) => `searched ${q}` });
    const [tool] = await document.modelContext!.getTools();
    await expect(
      document.modelContext!.executeTool(tool as never, '{"q":"hats"}'),
    ).resolves.toBe('searched hats');
  });

  it('can be uninstalled', async () => {
    const handle = instrumentWebMCP({ span: recordingSpan });
    handle.uninstall();
    await register();
    // The install span stands: the installation did happen. Nothing after it should.
    expect(spans.map((s) => s.name)).toEqual(['webmcp.install']);
  });

  it('stops watching registered tool signals after uninstall', async () => {
    const handle = instrumentWebMCP({ span: recordingSpan });
    const controller = new AbortController();
    await document.modelContext!.registerTool(
      {
        name: 'checkout',
        description: 'Check out',
        execute: () => 'ok',
      } as never,
      { signal: controller.signal } as never,
    );

    handle.uninstall();
    controller.abort();

    expect(spans.some((span) => span.name === 'webmcp.tool.withdraw')).toBe(
      false,
    );
  });

  it('instruments calls through an existing reference to the shared model context', async () => {
    const sharedModelContext = document.modelContext!;
    instrumentWebMCP({ span: recordingSpan });

    await sharedModelContext.registerTool({
      name: 'retained-reference',
      description: 'Registered through a retained browser reference',
      execute: () => 'ok',
    });

    expect(spans.some((span) => span.name === 'webmcp.tool.register')).toBe(
      true,
    );
  });

  it('shares one installation across repeated setup and removes it after the last uninstall', async () => {
    const first = instrumentWebMCP({ span: recordingSpan });
    const second = instrumentWebMCP({ span: recordingSpan });

    await register({ name: 'first' });
    expect(
      spans.filter((span) => span.name === 'webmcp.tool.register'),
    ).toHaveLength(1);

    first.uninstall();
    await register({ name: 'second' });
    expect(
      spans.filter((span) => span.name === 'webmcp.tool.register'),
    ).toHaveLength(2);

    second.uninstall();
    await register({ name: 'third' });
    expect(
      spans.filter((span) => span.name === 'webmcp.tool.register'),
    ).toHaveLength(2);
  });

  it('does nothing when WebMCP is unavailable', () => {
    delete (document as { modelContext?: unknown }).modelContext;
    expect(() => instrumentWebMCP({ span: recordingSpan })).not.toThrow();
  });

  it('is safe to initialise during server rendering', () => {
    const browserDocument = globalThis.document;
    Object.defineProperty(globalThis, 'document', {
      value: undefined,
      configurable: true,
    });

    try {
      expect(() => instrumentWebMCP({ span: recordingSpan })).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, 'document', {
        value: browserDocument,
        configurable: true,
        writable: true,
      });
    }
  });
  it("records a withdrawal when the tool's signal aborts", async () => {
    instrumentWebMCP({ span: recordingSpan });
    // One controller per tool is how a library unregisters: aborting it is the
    // only signal that a tool the agent could see is gone.
    const controller = new AbortController();
    await document.modelContext!.registerTool(
      {
        name: 'checkout',
        description: 'Check out',
        execute: () => 'ok',
      } as never,
      { signal: controller.signal } as never,
    );
    expect(spans.some((s) => s.name === 'webmcp.tool.withdraw')).toBe(false);

    controller.abort();

    const span = spans.find((s) => s.name === 'webmcp.tool.withdraw');
    expect(span?.attributes['webmcp.tool.name']).toBe('checkout');
  });

  it('withdraws only once, however many times the signal is aborted', async () => {
    instrumentWebMCP({ span: recordingSpan });
    const controller = new AbortController();
    await document.modelContext!.registerTool(
      {
        name: 'checkout',
        description: 'Check out',
        execute: () => 'ok',
      } as never,
      { signal: controller.signal } as never,
    );
    controller.abort();
    controller.abort();

    expect(spans.filter((s) => s.name === 'webmcp.tool.withdraw')).toHaveLength(
      1,
    );
  });

  it('emits an install span even when nothing registers afterwards', () => {
    instrumentWebMCP({ span: recordingSpan });
    // The signature of calling instrumentWebMCP() *after* registering tools:
    // an installation that saw nothing, which is otherwise indistinguishable
    // from an app with no tools at all.
    expect(spans.map((s) => s.name)).toEqual(['webmcp.install']);
  });

  it('stamps one installation id across install, registration and execution', async () => {
    instrumentWebMCP({ span: recordingSpan });
    await register();
    const [tool] = await document.modelContext!.getTools();
    await document.modelContext!.executeTool(tool as never, '{"q":"x"}');

    const ids = new Set(
      spans.map((s) => s.attributes['webmcp.installation.id']),
    );
    expect(ids.size).toBe(1);
    expect([...ids][0]).toEqual(expect.any(String));
  });
});
