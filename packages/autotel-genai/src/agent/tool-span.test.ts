import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { init, trace } from 'autotel';
import { createMemoryExporter } from 'autotel/testing';
import { defineAgentToolCall } from './index.js';

/**
 * A tool call is an operation: it has a name, a duration, a status, and an
 * input that produced an output. Recorded onto whatever span happened to be
 * open, a second tool call overwrites the first and neither one keeps its own
 * duration. Run against the real SDK rather than a mocked context, because the
 * span structure is the thing under test.
 */
const exporter = createMemoryExporter();

const search = defineAgentToolCall(
  (query: string) => ({
    action: 'agent.search',
    agent: { id: 'researcher' },
    tool: { name: 'search_docs', input: { query } },
  }),
  () => async (query: string) => ({ hits: query.length }),
);

const write = defineAgentToolCall(
  (path: string) => ({
    action: 'agent.write',
    agent: { id: 'researcher' },
    tool: { name: 'write_file', input: { path } },
  }),
  () => async (path: string) => ({ written: path }),
);

describe('agent tool calls', () => {
  beforeAll(() => {
    init({
      service: 'tool-span-test',
      spanProcessor: new SimpleSpanProcessor(exporter),
    });
  });

  beforeEach(() => {
    exporter.reset();
  });

  it('gives each tool call its own span under the run', async () => {
    const run = trace('research.run', async () => {
      await search('refund policy');
      await write('notes.md');
    });

    await run();

    await expect
      .poll(() => exporter.findSpan('execute_tool write_file'))
      .toBeDefined();

    const searchSpan = exporter.findSpan('execute_tool search_docs');
    const writeSpan = exporter.findSpan('execute_tool write_file');
    const runSpan = exporter.findSpan('research.run');

    expect(searchSpan?.attributes['tool.name']).toBe('search_docs');
    expect(writeSpan?.attributes['tool.name']).toBe('write_file');
    // Each call keeps its own evidence rather than the last one winning.
    expect(searchSpan?.attributes['tool.input_hash']).not.toBe(
      writeSpan?.attributes['tool.input_hash'],
    );
    expect(searchSpan?.attributes['tool.status']).toBe('complete');
    expect(searchSpan?.parentSpanId).toBe(runSpan?.spanId);
  });

  it('records each fact under one name', async () => {
    // The span attributes are snake_case and the wide event carried the same
    // fields camelCased, so every tool call landed twice under two spellings:
    // double the cardinality, and a query that has to guess which one is here.
    const run = trace('research.spelling', async () => {
      await search('refund policy');
    });

    await run();

    await expect
      .poll(() => exporter.findSpan('execute_tool search_docs'))
      .toBeDefined();
    const attributes = exporter.findSpan(
      'execute_tool search_docs',
    )?.attributes;

    expect(attributes?.['tool.input_hash']).toBeTypeOf('string');
    expect(attributes).not.toHaveProperty('tool.inputHash');
    expect(attributes).not.toHaveProperty('tool.outputHash');
    expect(attributes).not.toHaveProperty('tool.executionMs');
  });
});
