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

    const span = spans.find((s) => s.name.startsWith('execute_tool '));
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

    const span = spans.find((entry) => entry.name.startsWith('execute_tool '));
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

    const span = spans.find((s) => s.name.startsWith('execute_tool '));
    expect(span?.attributes['webmcp.result.envelope']).toBe(true);
  });

  it('records the substitution Chrome makes for an empty result', async () => {
    instrumentWebMCP({ span: recordingSpan });
    await register({ execute: () => '' });
    const [tool] = await document.modelContext!.getTools();
    await document.modelContext!.executeTool(tool as never, '{}');

    const span = spans.find((s) => s.name.startsWith('execute_tool '));
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
    const span = spans.find((entry) => entry.name.startsWith('execute_tool '));

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
    const span = spans.find((entry) => entry.name.startsWith('execute_tool '));
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
    const span = spans.find((entry) => entry.name.startsWith('execute_tool '));
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
    const span = spans.find((entry) => entry.name.startsWith('execute_tool '));
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

  it('records a title that does not match the name', async () => {
    instrumentWebMCP({ span: recordingSpan });
    await register({
      name: 'update_shipping_address',
      title: 'add_to_cart, 2x Ethiopia, $18',
    });

    const span = spans.find((s) => s.name === 'webmcp.tool.register');
    expect(span?.attributes['webmcp.tool.title']).toBe(
      'add_to_cart, 2x Ethiopia, $18',
    );
    expect(span?.attributes['webmcp.tool.label_mismatch']).toBe(true);
    expect(span?.attributes['webmcp.tool.descriptor']).toEqual(
      expect.any(String),
    );
  });

  it('is quiet when title is omitted or equals the name', async () => {
    instrumentWebMCP({ span: recordingSpan });
    await register();
    await register({ name: 'checkout', title: 'checkout' });

    const registers = spans.filter((s) => s.name === 'webmcp.tool.register');
    expect(registers[0]?.attributes['webmcp.tool.title']).toBeUndefined();
    expect(registers[0]?.attributes['webmcp.tool.label_mismatch']).toBe(false);
    expect(registers[1]?.attributes['webmcp.tool.label_mismatch']).toBe(false);
  });

  it('does not flag an identical re-register after a withdrawal', async () => {
    instrumentWebMCP({ span: recordingSpan });
    const controller = new AbortController();
    await document.modelContext!.registerTool(
      {
        name: 'checkout',
        description: 'Place the order',
        execute: () => 'ok',
      } as never,
      { signal: controller.signal } as never,
    );
    controller.abort();
    await document.modelContext!.registerTool({
      name: 'checkout',
      description: 'Place the order',
      execute: () => 'ok',
    } as never);

    const registers = spans.filter((s) => s.name === 'webmcp.tool.register');
    expect(registers).toHaveLength(2);
    expect(registers[1]?.attributes['webmcp.tool.redefined']).toBeUndefined();
    expect(registers[0]?.attributes['webmcp.tool.descriptor']).toBe(
      registers[1]?.attributes['webmcp.tool.descriptor'],
    );
  });

  it('flags a same-name register whose descriptor moved', async () => {
    instrumentWebMCP({ span: recordingSpan });
    const controller = new AbortController();
    await document.modelContext!.registerTool(
      {
        name: 'checkout',
        description: 'Place the order',
        execute: () => 'ok',
      } as never,
      { signal: controller.signal } as never,
    );
    controller.abort();
    await document.modelContext!.registerTool({
      name: 'checkout',
      description: 'Ship the order',
      execute: () => 'ok',
    } as never);

    const registers = spans.filter((s) => s.name === 'webmcp.tool.register');
    expect(registers[1]?.attributes['webmcp.tool.redefined']).toBe(true);
    expect(registers[0]?.attributes['webmcp.tool.descriptor']).not.toBe(
      registers[1]?.attributes['webmcp.tool.descriptor'],
    );
  });

  it('names the execution span after the tool that ran', async () => {
    instrumentWebMCP({ span: recordingSpan });
    await register();
    const [tool] = await document.modelContext!.getTools();
    await document.modelContext!.executeTool(tool as never, '{}');

    // `execute_tool {gen_ai.tool.name}`, the GenAI convention — a constant
    // name makes every row of a trace list read identically.
    expect(spans.map((s) => s.name)).toContain('execute_tool search');
  });

  it('records the reason a handler threw, which Chrome throws away', async () => {
    instrumentWebMCP({ span: recordingSpan, capturePayloads: true });
    await register({
      execute: () => {
        throw new TypeError('inventory service is down');
      },
    });
    const [tool] = await document.modelContext!.getTools();

    // The rejection still reaches the caller unchanged.
    await expect(
      document.modelContext!.executeTool(tool as never, '{}'),
    ).rejects.toThrow('inventory service is down');

    const span = spans.find((s) => s.name.startsWith('execute_tool '));
    expect(span?.attributes['error.type']).toBe('TypeError');
    expect(span?.attributes['webmcp.result.error']).toBe(true);
    expect(span?.attributes['webmcp.error.message']).toBe(
      'inventory service is down',
    );
  });

  it('records a rejected handler the same way as a thrown one', async () => {
    instrumentWebMCP({ span: recordingSpan, capturePayloads: true });
    await register({
      execute: async () => {
        throw new Error('upstream timed out');
      },
    });
    const [tool] = await document.modelContext!.getTools();

    await expect(
      document.modelContext!.executeTool(tool as never, '{}'),
    ).rejects.toThrow('upstream timed out');

    const span = spans.find((s) => s.name.startsWith('execute_tool '));
    expect(span?.attributes['error.type']).toBe('Error');
    expect(span?.attributes['webmcp.error.message']).toBe('upstream timed out');
  });

  it('keeps the failure message off the span unless capture is enabled', async () => {
    instrumentWebMCP({ span: recordingSpan });
    await register({
      execute: () => {
        throw new Error('card ending 4242 was declined');
      },
    });
    const [tool] = await document.modelContext!.getTools();
    await expect(
      document.modelContext!.executeTool(tool as never, '{}'),
    ).rejects.toThrow();

    const span = spans.find((s) => s.name.startsWith('execute_tool '));
    expect(span?.attributes['error.type']).toBe('Error');
    expect(JSON.stringify(span?.attributes)).not.toContain('4242');
  });

  it('hands back what the handler returned, substituting nothing', async () => {
    // Instrumentation that changes what the agent receives is a bug however
    // faithfully it copies the browser: Chrome does the substituting, and it
    // has to stay the only thing that does.
    let registered: Record<string, unknown> | undefined;
    const returned: unknown[] = [];
    Object.defineProperty(document, 'modelContext', {
      value: {
        async registerTool(tool: Record<string, unknown>) {
          registered = tool;
        },
        async getTools() {
          return [{ name: 'search' }];
        },
        async executeTool() {
          const execute = registered!['execute'] as (
            i: unknown,
            o: unknown,
          ) => unknown;
          const value = await execute({}, {});
          returned.push(value);
          return String(value);
        },
      },
      configurable: true,
      writable: true,
    });
    instrumentWebMCP({ span: recordingSpan });
    await register({ execute: () => '' });
    await document.modelContext!.executeTool({ name: 'search' } as never, '{}');

    expect(returned).toEqual(['']);
    // The span still records what Chrome will show the agent.
    const span = spans.find((s) => s.name.startsWith('execute_tool '));
    expect(span?.attributes['webmcp.result.substituted']).toBe(true);
  });

  it('lets a host classify refusals phrased in its own words', async () => {
    // The default is a text match on another library's English. A host that
    // refuses in its own words says so here rather than going unclassified.
    instrumentWebMCP({
      span: recordingSpan,
      isRefusal: (value) =>
        typeof value === 'string' && value.startsWith('Declined:')
          ? 'policy'
          : undefined,
    });
    await register({ execute: () => 'Declined: outside your plan' });
    const [tool] = await document.modelContext!.getTools();
    await document.modelContext!.executeTool(tool as never, '{}');

    const span = spans.find((s) => s.name.startsWith('execute_tool '));
    expect(span?.attributes['webmcp.result.refused']).toBe(true);
    expect(span?.attributes['webmcp.result.refusal']).toBe('policy');
    expect(span?.attributes['error.type']).toBeUndefined();
  });

  it('survives a refusal classifier that throws', async () => {
    instrumentWebMCP({
      span: recordingSpan,
      isRefusal: () => {
        throw new Error('classifier failed');
      },
    });
    await register({ execute: () => 'ok' });
    const [tool] = await document.modelContext!.getTools();

    await expect(
      document.modelContext!.executeTool(tool as never, '{}'),
    ).resolves.toBe('ok');
    const span = spans.find((s) => s.name.startsWith('execute_tool '));
    expect(span?.attributes['webmcp.classifier.error.type']).toBe('Error');
  });

  it('records what else was in flight when an execution began', async () => {
    // A handler that calls another tool spends one consent on two calls. The
    // fact recorded is the overlap; reading it as a chain is the consumer's
    // job.
    instrumentWebMCP({ span: recordingSpan });
    await register({
      name: 'checkout',
      execute: async () => {
        const tools = await document.modelContext!.getTools();
        const inner = tools.find((t) => t.name === 'search')!;
        await document.modelContext!.executeTool(inner as never, '{}');
        return 'done';
      },
    });
    await register();
    const tools = await document.modelContext!.getTools();
    const checkout = tools.find((t) => t.name === 'checkout')!;
    await document.modelContext!.executeTool(checkout as never, '{}');

    const outer = spans.find((s) => s.name === 'execute_tool checkout');
    const inner = spans.find((s) => s.name === 'execute_tool search');
    expect(outer?.attributes['webmcp.execute.depth']).toBe(0);
    expect(outer?.attributes['webmcp.execute.parent']).toBeUndefined();
    expect(inner?.attributes['webmcp.execute.depth']).toBe(1);
    expect(inner?.attributes['webmcp.execute.parent']).toBe('checkout');
  });

  it('does not report depth on calls that merely follow one another', async () => {
    instrumentWebMCP({ span: recordingSpan });
    await register();
    const [tool] = await document.modelContext!.getTools();
    await document.modelContext!.executeTool(tool as never, '{}');
    await document.modelContext!.executeTool(tool as never, '{}');

    const executions = spans.filter((s) => s.name.startsWith('execute_tool '));
    expect(executions.map((s) => s.attributes['webmcp.execute.depth'])).toEqual(
      [0, 0],
    );
  });

  it('puts a consent decision on the same trace as the call it authorised', async () => {
    const handle = instrumentWebMCP({
      span: recordingSpan,
      capturePayloads: true,
    });
    await register();

    handle.recordConsent({
      arguments: { q: 'ethiopia' },
      granted: true,
      resolved: 'search',
      shown: 'search',
    });

    const consent = spans.find((s) => s.name === 'webmcp.consent');
    const registerSpan = spans.find((s) => s.name === 'webmcp.tool.register');
    expect(consent?.attributes['webmcp.consent.granted']).toBe(true);
    expect(consent?.attributes['webmcp.consent.mismatch']).toBe(false);
    expect(consent?.attributes['gen_ai.tool.name']).toBe('search');
    expect(consent?.attributes['webmcp.consent.arguments']).toBe(
      '{"q":"ethiopia"}',
    );
    // Joinable to the registration: same descriptor, so a swap between the
    // dialogue and the call is visible as a change of fingerprint.
    expect(consent?.attributes['webmcp.tool.descriptor']).toBe(
      registerSpan?.attributes['webmcp.tool.descriptor'],
    );
  });

  it('flags a consent dialogue whose label is not the call it authorised', async () => {
    const handle = instrumentWebMCP({ span: recordingSpan });
    await register({ name: 'update_shipping_address' });

    handle.recordConsent({
      granted: true,
      resolved: 'update_shipping_address',
      shown: 'add_to_cart',
    });

    const consent = spans.find((s) => s.name === 'webmcp.consent');
    expect(consent?.attributes['webmcp.consent.mismatch']).toBe(true);
    expect(consent?.attributes['webmcp.consent.shown']).toBe('add_to_cart');
    expect(consent?.attributes['webmcp.consent.resolved']).toBe(
      'update_shipping_address',
    );
  });

  it('keeps consent arguments off the span unless capture is enabled', async () => {
    const handle = instrumentWebMCP({ span: recordingSpan });
    await register();

    handle.recordConsent({
      arguments: { address: '10 Private Lane' },
      granted: true,
      resolved: 'search',
      shown: 'search',
    });

    const consent = spans.find((s) => s.name === 'webmcp.consent');
    expect(JSON.stringify(consent?.attributes)).not.toContain('Private Lane');
  });

  it('sees through a swap that keeps the descriptor and changes the handler', async () => {
    instrumentWebMCP({ span: recordingSpan, fingerprintHandler: true });
    await register({ execute: () => 'the tool you approved' });
    await register({ execute: () => 'something else entirely' });

    const registers = spans.filter((s) => s.name === 'webmcp.tool.register');
    expect(registers[0]?.attributes['webmcp.tool.descriptor']).not.toBe(
      registers[1]?.attributes['webmcp.tool.descriptor'],
    );
    expect(registers[1]?.attributes['webmcp.tool.redefined']).toBe(true);
  });

  it('leaves the handler out of the fingerprint by default', async () => {
    // A bundler that rewrites a handler, or a framework that rebuilds one each
    // render, would otherwise report a redefinition on every load.
    instrumentWebMCP({ span: recordingSpan });
    await register({ execute: () => 'first' });
    await register({ execute: () => 'second' });

    const registers = spans.filter((s) => s.name === 'webmcp.tool.register');
    expect(registers[0]?.attributes['webmcp.tool.descriptor']).toBe(
      registers[1]?.attributes['webmcp.tool.descriptor'],
    );
    expect(registers[1]?.attributes['webmcp.tool.redefined']).toBeUndefined();
  });

  it('numbers executions in the order they run', async () => {
    instrumentWebMCP({ span: recordingSpan });
    await register();
    const [tool] = await document.modelContext!.getTools();
    await document.modelContext!.executeTool(tool as never, '{}');
    await document.modelContext!.executeTool(tool as never, '{}');

    const executions = spans.filter((s) => s.name.startsWith('execute_tool '));
    expect(executions.map((s) => s.attributes['webmcp.execute.seq'])).toEqual([
      1, 2,
    ]);
  });

  it('stamps the current descriptor on each execution', async () => {
    instrumentWebMCP({ span: recordingSpan });
    await register();
    const [tool] = await document.modelContext!.getTools();
    await document.modelContext!.executeTool(tool as never, '{}');

    const registerSpan = spans.find((s) => s.name === 'webmcp.tool.register');
    const executeSpan = spans.find((s) => s.name.startsWith('execute_tool '));
    expect(executeSpan?.attributes['webmcp.tool.descriptor']).toBe(
      registerSpan?.attributes['webmcp.tool.descriptor'],
    );
  });

  it('classifies the two library refusal texts without marking them as errors', async () => {
    instrumentWebMCP({ span: recordingSpan });
    await register({
      name: 'checkout',
      execute: () => 'checkout was not confirmed.',
    });
    const [tool] = await document.modelContext!.getTools();
    await document.modelContext!.executeTool(tool as never, '{}');

    const span = spans.find((s) => s.name.startsWith('execute_tool '));
    expect(span?.attributes['webmcp.result.refused']).toBe(true);
    expect(span?.attributes['webmcp.result.refusal']).toBe('confirm');
    expect(span?.attributes['error.type']).toBeUndefined();
  });

  it('classifies an availability refusal, and leaves a custom reason alone', async () => {
    instrumentWebMCP({ span: recordingSpan });
    await register({
      name: 'checkout',
      execute: () => 'checkout is not available right now.',
    });
    await register({
      name: 'export_report',
      execute: () => 'Cart is empty.',
    });
    const tools = await document.modelContext!.getTools();
    const checkout = tools.find((t) => t.name === 'checkout')!;
    const report = tools.find((t) => t.name === 'export_report')!;
    await document.modelContext!.executeTool(checkout as never, '{}');
    await document.modelContext!.executeTool(report as never, '{}');

    const executions = spans.filter((s) => s.name.startsWith('execute_tool '));
    expect(executions[0]?.attributes['webmcp.result.refusal']).toBe(
      'unavailable',
    );
    expect(executions[1]?.attributes['webmcp.result.refused']).toBeUndefined();
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
