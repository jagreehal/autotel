import { initFull } from 'autotel-web/full';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
// The default entry, which is the one that wires autotel-web's span() in.
import { instrumentWebMCP } from './index';

interface ExportedSpan {
  name: string;
  attributes: Record<string, unknown>;
  status: { code: number };
}

const exported: ExportedSpan[] = [];

function installModelContext() {
  const tools = new Map<string, Record<string, unknown>>();
  const modelContext = {
    async registerTool(tool: Record<string, unknown>) {
      if (tools.has(String(tool['name'])))
        throw new DOMException('Duplicate tool', 'InvalidStateError');
      tools.set(String(tool['name']), tool);
    },
    async getTools() {
      return [...tools.values()].map((tool) => ({ name: tool['name'] }));
    },
    async executeTool(tool: { name: string }, input: string) {
      const execute = tools.get(tool.name)?.['execute'] as (
        value: unknown,
        options: unknown,
      ) => unknown;
      return execute(JSON.parse(input), {
        signal: new AbortController().signal,
      });
    },
  };
  Object.defineProperty(document, 'modelContext', {
    value: modelContext,
    configurable: true,
    writable: true,
  });
  return modelContext;
}

describe('instrumentWebMCP telemetry export', () => {
  beforeAll(() => {
    initFull({
      service: 'autotel-webmcp-test',
      spanProcessor: {
        onStart() {},
        onEnd(span) {
          exported.push(span as unknown as ExportedSpan);
        },
        forceFlush: async () => {},
        shutdown: async () => {},
      },
      session: false,
      captureNavigation: false,
      captureFetch: false,
      captureXHR: false,
      captureNetworkTiming: false,
      captureErrors: false,
      captureWebVitals: false,
    });
  });

  beforeEach(() => {
    exported.length = 0;
    installModelContext();
  });

  it('exports canonical attributes for an agent-visible tool result', async () => {
    instrumentWebMCP({ capturePayloads: true });
    await document.modelContext!.registerTool({
      name: 'search',
      description: 'Search',
      execute: () => 'three results',
    });
    const [tool] = await document.modelContext!.getTools();
    await document.modelContext!.executeTool(tool!, '{"q":"hat"}');

    const span = exported.find((candidate) =>
      candidate.name.startsWith('execute_tool '),
    );
    expect(span?.attributes).toMatchObject({
      'gen_ai.operation.name': 'execute_tool',
      'gen_ai.tool.name': 'search',
      'gen_ai.tool.call.arguments': '{"q":"hat"}',
      'gen_ai.tool.call.result': 'three results',
    });
  });

  it('exports rejected registrations with error status', async () => {
    instrumentWebMCP();
    const tool = {
      name: 'duplicate',
      description: 'Duplicate',
      execute: () => 'ok',
    };
    await document.modelContext!.registerTool(tool);
    await expect(document.modelContext!.registerTool(tool)).rejects.toThrow(
      'Duplicate tool',
    );

    const failures = exported.filter(
      (candidate) =>
        candidate.name === 'webmcp.tool.register' &&
        candidate.attributes['gen_ai.tool.name'] === 'duplicate',
    );
    expect(failures.at(-1)?.status.code).toBe(2);
  });
});
