/**
 * Tasks and Skills over MCP against the real 2026-07-28 SDK, end to end. The
 * SDK has no API for either, so the server sets the handlers the way such a
 * server must, with `setRequestHandler`, and the client sends them with
 * `request()`. Spans and the duration metric are read back from both ends.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  metrics,
  SpanKind,
  SpanStatusCode,
  type Attributes,
} from '@opentelemetry/api';
import { createTraceCollector, type TraceCollector } from 'autotel/testing';
import { z } from 'zod';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import { instrumentMcpServer } from './server';
import { instrumentMcpClient } from './client';
import { traceExtensionClientRequest } from './tasks-skills';
import { resolveConfig } from './types';

let collector: TraceCollector;
/** Every metric recording, as `[instrument, value, attributes]`. */
const recorded: Array<[string, number, Attributes | undefined]> = [];
beforeAll(() => {
  const instrument = (name: string) => {
    const record = (value: number, attributes?: Attributes) =>
      recorded.push([name, value, attributes]);
    return { add: record, record };
  };
  metrics.setGlobalMeterProvider({
    getMeter: () =>
      // SAFETY: the code under test calls only createCounter and
      // createHistogram, and records through add/record.
      ({ createCounter: instrument, createHistogram: instrument }) as never,
  });
});
beforeEach(() => {
  collector = createTraceCollector();
  recorded.length = 0;
});

/** A task as 2026-07-28's Tasks extension shapes it (SEP-2663). */
const TASK = {
  taskId: 'task_42',
  status: 'working',
  createdAt: '2026-11-28T00:00:00Z',
  lastUpdatedAt: '2026-11-28T00:00:00Z',
  ttlMs: 60_000,
};
/** What a client sends to say it can take a task back. */
const TASKS_CAPABLE = {
  'io.modelcontextprotocol/clientCapabilities': {
    extensions: { 'io.modelcontextprotocol/tasks': {} },
  },
};
const SKILL = {
  uri: 'skill://acme/billing/refunds/SKILL.md',
  frontmatter: { name: 'refunds', description: 'Process refunds per policy' },
  resources: 'dynamic',
};

const Any = z.looseObject({});
const Empty = z.object({});
/** The part of the v2 handler context a retried call reads. */
interface RetryContext {
  mcpReq: { inputResponses?: Wire };
}
/** A JSON object off the wire, as the handlers and the client see it. */
type Wire = z.infer<typeof Any>;
const TaskParams = z.looseObject({ taskId: z.string() });
const UriParams = z.looseObject({ uri: z.string() });

async function connect() {
  const server = instrumentMcpServer(
    new McpServer(
      { name: 'research', version: '1.0.0' },
      { capabilities: { tools: {}, resources: {} } },
    ),
    {},
  );
  server.registerTool(
    'confirm',
    { description: 'Asks before spending', inputSchema: z.object({}) },
    // A multi-round-trip pause until the user answers; then the work.
    // SAFETY: registerTool types its callback by CallToolResult; the SDK sends
    // any object back, and this one is the 2026-07-28 InputRequiredResult.
    async (_args: z.infer<typeof Empty>, ctx: RetryContext) =>
      ctx.mcpReq.inputResponses
        ? ({ content: [{ type: 'text', text: 'not spent' }] } as never)
        : ({
            resultType: 'input_required',
            inputRequests: {
              spend: {
                method: 'elicitation/create',
                params: {
                  message: 'Spend $5?',
                  requestedSchema: { type: 'object', properties: {} },
                },
              },
            },
          } as never),
  );
  server.registerTool(
    'research',
    {
      description: 'Deep account research',
      inputSchema: z.object({ q: z.string() }),
    },
    // Run as a task: the answer is the task itself, marked resultType "task".
    // SAFETY: as above; this is the Tasks extension's CreateTaskResult.
    async () => ({ resultType: 'task', ...TASK }) as never,
  );
  const low = server.server;
  const handle = (
    method: string,
    params: z.ZodType,
    answer: (params: Wire) => Wire,
  ) =>
    // SAFETY: setRequestHandler's overloads are keyed by the SDK's own method
    // names; a custom method takes (method, { params, result }, handler), which
    // is what is passed, so only the overload selection needs overriding.
    low.setRequestHandler(
      method as never,
      { params, result: Any } as never,
      (async (p: Wire) => answer(p)) as never,
    );
  // 2026-07-28: tasks/get carries the outcome. task_42 finished; task_7 hit a tool error.
  handle('tasks/get', TaskParams, (p) => ({
    resultType: 'complete',
    ...TASK,
    taskId: p.taskId,
    status: 'completed',
    result: {
      content: [
        {
          type: 'text',
          text: p.taskId === 'task_7' ? 'quota exceeded' : 'done',
        },
      ],
      isError: p.taskId === 'task_7',
    },
  }));
  handle('tasks/update', TaskParams, (p) => ({
    resultType: 'complete',
    ...TASK,
    taskId: p.taskId,
  }));
  handle('tasks/result', TaskParams, () => ({
    content: [{ type: 'text', text: 'quota exceeded' }],
    isError: true,
  }));
  // 2025-11-25's experimental feature, still traced for servers on that revision.
  handle('tasks/list', Any, () => ({
    tasks: [TASK, { ...TASK, taskId: 'task_43' }],
  }));
  handle('resources/directory/read', UriParams, () => ({
    resources: [
      { uri: 'skill://acme/billing/refunds/SKILL.md', name: 'SKILL.md' },
    ],
  }));
  handle('skills/list', Any, () => ({
    skills: [SKILL],
    ttlMs: 300_000,
    cacheScope: 'public',
  }));
  handle('skills/get', UriParams, (p) => {
    if (p.uri !== SKILL.uri)
      throw Object.assign(new Error('Unknown skill'), { code: -32_602 });
    return { skill: SKILL, ttlMs: 300_000, cacheScope: 'public' };
  });

  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = instrumentMcpClient(
    new Client({ name: 'agent', version: '1.0.0' }),
    {},
  );
  await client.connect(clientSide);
  return client;
}

const send = (client: Client, method: string, params: Wire = {}) =>
  // SAFETY: request() is typed by the SDK's own request union; these methods
  // are extension and custom methods it accepts at runtime with a result schema.
  client.request({ method, params } as never, Any);

const serverSpan = (name: string) =>
  collector
    .getSpans()
    .find((s) => s.name === name && s.kind === SpanKind.SERVER);
const clientSpan = (name: string) =>
  collector
    .getSpans()
    .find((s) => s.name === name && s.kind === SpanKind.CLIENT);
const durations = (instrument: RegExp, method: string) =>
  recorded.filter(
    ([name, , attributes]) =>
      instrument.test(name) && attributes?.['mcp.method.name'] === method,
  );

describe('Tasks', () => {
  it('marks a tool call that ran as a task, on both ends, and keeps it out of done-work latency', async () => {
    const client = await connect();
    // Sent through request() with the extension declared, so a task may come back.
    await send(client, 'tools/call', {
      name: 'research',
      arguments: { q: 'acme' },
      _meta: TASKS_CAPABLE,
    });

    for (const span of [
      serverSpan('tools/call research'),
      clientSpan('tools/call research'),
    ]) {
      expect(span?.attributes).toMatchObject({
        'mcp.task.augmented': true,
        'mcp.task.id': 'task_42',
        'mcp.task.status': 'working',
      });
      // Accepted, not done: neither a success nor a failure yet.
      expect(span?.status.code).toBe(SpanStatusCode.UNSET);
    }
    const span = serverSpan('tools/call research');
    expect(durations(/server/, 'tools/call')[0]?.[2]).toMatchObject({
      'mcp.task.augmented': true,
    });
    expect(durations(/client/, 'tools/call')[0]?.[2]).toMatchObject({
      'mcp.task.augmented': true,
    });
    // The caller's span exists, and carries trace context to the server.
    expect(span?.parentSpanId).toBe(clientSpan('tools/call research')?.spanId);
  });

  it('marks the caller span when a task comes back to the client', async () => {
    const answer = { resultType: 'task', ...TASK };
    const request = traceExtensionClientRequest(
      async () => answer,
      {},
      resolveConfig({}),
    );
    await request({
      method: 'tools/call',
      params: { name: 'research', arguments: {}, _meta: TASKS_CAPABLE },
    });
    const span = clientSpan('tools/call research');
    expect(span?.attributes).toMatchObject({
      'gen_ai.tool.name': 'research',
      'mcp.task.augmented': true,
      'mcp.task.id': 'task_42',
    });
    expect(span?.status.code).toBe(SpanStatusCode.UNSET);
    expect(durations(/client/, 'tools/call')[0]?.[2]).toMatchObject({
      'mcp.task.augmented': true,
    });
  });

  it('leaves a client tools/call that did not offer to take a task to callTool', async () => {
    const request = traceExtensionClientRequest(
      async () => ({}),
      {},
      resolveConfig({}),
    );
    await request({
      method: 'tools/call',
      params: { name: 'research', arguments: {} },
    });
    expect(collector.getSpans()).toHaveLength(0);
  });

  it('traces tasks/get with the task id and the status it reported', async () => {
    const client = await connect();
    await send(client, 'tasks/get', { taskId: 'task_42' });
    for (const span of [serverSpan('tasks/get'), clientSpan('tasks/get')]) {
      expect(span?.attributes).toMatchObject({
        'mcp.method.name': 'tasks/get',
        'mcp.task.id': 'task_42',
        'mcp.task.status': 'completed',
      });
      expect(span?.status.code).toBe(SpanStatusCode.OK);
    }
    // The server span continues the client's trace.
    expect(serverSpan('tasks/get')?.parentSpanId).toBe(
      clientSpan('tasks/get')?.spanId,
    );
    // A task id is never a metric label.
    expect(durations(/server/, 'tasks/get')[0]?.[2]).not.toHaveProperty(
      'mcp.task.id',
    );
  });

  it('records a completed task whose result is a tool error as the work failing', async () => {
    const client = await connect();
    await send(client, 'tasks/get', { taskId: 'task_7' });
    for (const span of [serverSpan('tasks/get'), clientSpan('tasks/get')]) {
      expect(span?.status.code).toBe(SpanStatusCode.ERROR);
      expect(span?.attributes['error.type']).toBe('tool_error');
      // Grouped like any other tool error, so two occurrences share a fingerprint.
      expect(span?.attributes['mcp.failure.category']).toBeDefined();
      expect(span?.attributes['mcp.failure.fingerprint']).toBeDefined();
    }
  });

  it('traces tasks/update with the task and the answers it carried', async () => {
    const client = await connect();
    await send(client, 'tasks/update', {
      taskId: 'task_42',
      inputResponses: { spend: { action: 'accept', content: {} } },
    });
    expect(serverSpan('tasks/update')?.attributes).toMatchObject({
      'mcp.task.id': 'task_42',
      'mcp.elicitation.action': ['accept'],
    });
  });

  it('marks the caller span when callTool gets a task back', async () => {
    const client = await connect();
    await client.callTool({ name: 'research', arguments: { q: 'acme' } });
    expect(clientSpan('tools/call research')?.attributes).toMatchObject({
      'mcp.task.augmented': true,
      'mcp.task.id': 'task_42',
    });
  });

  it('records a 2025-era tasks/result that failed as the work failing', async () => {
    const client = await connect();
    await send(client, 'tasks/result', { taskId: 'task_42' });
    const span = serverSpan('tasks/result');
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    expect(span?.attributes['error.type']).toBe('tool_error');
  });

  it('counts the tasks a tasks/list returned', async () => {
    const client = await connect();
    await send(client, 'tasks/list');
    expect(serverSpan('tasks/list')?.attributes['mcp.task.count']).toBe(2);
  });
});

describe('Multi-round-trip pause', () => {
  it('leaves a paused call UNSET rather than OK', async () => {
    const client = await connect();
    await send(client, 'tools/call', { name: 'confirm', arguments: {} }).catch(
      () => null,
    );
    const span = serverSpan('tools/call confirm');
    expect(span?.attributes['mcp.input_required']).toBe(true);
    expect(span?.status.code).toBe(SpanStatusCode.UNSET);
  });

  it('records what the user answered on the retried call', async () => {
    const client = await connect();
    await send(client, 'tools/call', {
      name: 'confirm',
      arguments: {},
      inputResponses: { spend: { action: 'decline' } },
    });
    const span = serverSpan('tools/call confirm');
    expect(span?.attributes['mcp.elicitation.action']).toEqual(['decline']);
    expect(span?.attributes['mcp.input_required']).toBeUndefined();
    expect(span?.status.code).toBe(SpanStatusCode.OK);
  });
});

describe('Skills over MCP', () => {
  it('counts the skills a skills/list returned', async () => {
    const client = await connect();
    await send(client, 'skills/list');
    expect(clientSpan('skills/list')?.attributes['mcp.skill.count']).toBe(1);
    expect(serverSpan('skills/list')?.attributes['mcp.skill.count']).toBe(1);
  });

  it('names a skills/get span and its metric after the skill the server served', async () => {
    const client = await connect();
    await send(client, 'skills/get', { uri: SKILL.uri });
    const span = serverSpan('skills/get refunds');
    expect(span?.attributes).toMatchObject({
      'mcp.skill.name': 'refunds',
      'mcp.skill.uri': SKILL.uri,
    });
    expect(clientSpan('skills/get refunds')).toBeDefined();
    expect(durations(/server/, 'skills/get')[0]?.[2]).toMatchObject({
      'mcp.skill.name': 'refunds',
    });
  });

  it('traces resources/directory/read with the directory it listed', async () => {
    const client = await connect();
    await send(client, 'resources/directory/read', {
      uri: 'skill://acme/billing/refunds',
    });
    expect(serverSpan('resources/directory/read')?.attributes).toMatchObject({
      'mcp.method.name': 'resources/directory/read',
      'mcp.resource.uri': 'skill://acme/billing/refunds',
    });
  });

  it('keeps a URI the server does not serve off the span name and the metric', async () => {
    const client = await connect();
    await expect(
      send(client, 'skills/get', { uri: 'skill://made-up/SKILL.md' }),
    ).rejects.toThrow();
    const span = serverSpan('skills/get');
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    expect(span?.attributes['mcp.skill.uri']).toBe('skill://made-up/SKILL.md');
    expect(durations(/server/, 'skills/get')[0]?.[2]).not.toHaveProperty(
      'mcp.skill.name',
    );
  });
});
