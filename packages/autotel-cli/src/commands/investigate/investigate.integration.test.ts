import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import { runHealth, runCapabilities } from './health';
import { runDiscoverServices } from './discovery';
import { runQueryLogs, runQueryMetrics } from './signals';
import { runQueryTraces, runQuerySpans, runTraceGet } from './investigation';
import { runListServices, runListOperations, runServiceMap } from './topology';
import { runDiagnoseAnomalies, runDiagnoseErrors } from './diagnosis';
import { runCorrelate } from './correlation';
import { runLlmUsage } from './llm';
import { runScoreExplain } from './instrumentation';
import { resetJsonOutput } from '../../lib/json-output';

const FIXTURE = path.resolve(
  __dirname,
  '../../../../autotel-mcp/fixtures/telemetry.json',
);

/**
 * Integration test: every command group, end-to-end, against the bundled
 * fixture backend. Catches any regression where a CLI command stops
 * producing the documented `{ ok, command, data }` envelope.
 *
 * Strategy: spy on process.stdout.write, parse the JSON, assert shape.
 * Each command runs in its own test so a failure pinpoints the broken
 * group instead of failing the whole suite.
 */
interface Envelope<TData> {
  ok: boolean;
  command: string;
  data: TData;
  error?: { code: string; message: string };
}

describe('investigate commands (fixture backend)', () => {
  let stdoutChunks: string[] = [];
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetJsonOutput();
    stdoutChunks = [];
    writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        stdoutChunks.push(String(chunk));
        return true;
      });
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  const flags = { backend: 'fixture' as const, fixturePath: FIXTURE };

  /** The JSON envelope a command printed, with `data` typed by the test. */
  function capturedEnvelope<TData>(): Envelope<TData> {
    expect(stdoutChunks.length).toBeGreaterThan(0);
    const joined = stdoutChunks.join('');
    return JSON.parse(joined);
  }

  function expectOk<TData>(commandName: string): TData {
    const env = capturedEnvelope<TData>();
    expect(
      env.ok,
      `command="${env.command}" error=${JSON.stringify(env.error)}`,
    ).toBe(true);
    expect(env.command).toBe(commandName);
    expect(env.data).toBeDefined();
    return env.data;
  }

  it('health: returns healthy + signals', async () => {
    await runHealth(flags);
    const data = expectOk<{
      healthy: boolean;
      signals: { traces: string; metrics: string; logs: string };
    }>('health');
    expect(data.healthy).toBe(true);
    expect(data.signals.traces).toBe('available');
  });

  it('health: uses JSON for the resolved collector backend', async () => {
    const { resolvedFreshnessEncoding } = await import('./health');
    expect(resolvedFreshnessEncoding(undefined, { kind: 'collector' })).toBe(
      'json',
    );
  });

  it('capabilities: returns signal availability', async () => {
    await runCapabilities(flags);
    const data = expectOk<{ traces: string }>('capabilities');
    expect(data.traces).toBe('available');
  });

  it('discover services: returns count + services array', async () => {
    await runDiscoverServices(flags);
    const data = expectOk<{
      count: number;
      services: unknown[];
    }>('discover services');
    expect(data.count).toBeGreaterThan(0);
    expect(Array.isArray(data.services)).toBe(true);
  });

  it('query traces: returns items array', async () => {
    await runQueryTraces({ ...flags, limit: 5 });
    const data = expectOk<{ items: unknown[] }>('query traces');
    expect(Array.isArray(data.items)).toBe(true);
  });

  it('query spans: returns items array', async () => {
    await runQuerySpans({ ...flags, limit: 5 });
    const data = expectOk<{ items: unknown[] }>('query spans');
    expect(Array.isArray(data.items)).toBe(true);
  });

  it('query metrics: returns items array', async () => {
    await runQueryMetrics({ ...flags });
    const data = expectOk<{ items: unknown[] }>('query metrics');
    expect(Array.isArray(data.items)).toBe(true);
  });

  it('query logs: returns items array', async () => {
    await runQueryLogs({ ...flags });
    const data = expectOk<{ items: unknown[] }>('query logs');
    expect(Array.isArray(data.items)).toBe(true);
  });

  it('topology services: returns services array', async () => {
    await runListServices(flags);
    const data = expectOk<{ services: unknown[] }>('topology services');
    expect(Array.isArray(data.services)).toBe(true);
  });

  it('topology operations: returns operations for a service', async () => {
    // First grab a service name from the fixture.
    await runListServices(flags);
    const svcs = capturedEnvelope<{ services: Array<{ name: string }> }>().data
      .services;
    expect(svcs.length).toBeGreaterThan(0);
    stdoutChunks = [];
    await runListOperations({ ...flags, serviceName: svcs[0]!.name });
    const data = expectOk<{ operations: unknown[] }>('topology operations');
    expect(Array.isArray(data.operations)).toBe(true);
  });

  it('topology map: returns nodes + edges', async () => {
    await runServiceMap({ ...flags });
    const data = expectOk<{
      nodes: unknown[];
      edges: unknown[];
    }>('topology map');
    expect(Array.isArray(data.nodes)).toBe(true);
    expect(Array.isArray(data.edges)).toBe(true);
  });

  it('diagnose anomalies: returns array (possibly empty)', async () => {
    await runDiagnoseAnomalies(flags);
    const env = capturedEnvelope();
    expect(env.ok).toBe(true);
    expect(env.command).toBe('diagnose anomalies');
    expect(Array.isArray(env.data)).toBe(true);
  });

  it('diagnose errors: returns totalTraces + groups', async () => {
    await runDiagnoseErrors(flags);
    const data = expectOk<{
      totalTraces: number;
      groups: unknown[];
    }>('diagnose errors');
    expect(data.totalTraces).toBeTypeOf('number');
    expect(Array.isArray(data.groups)).toBe(true);
  });

  it('trace get: returns the trace by ID', async () => {
    await runQueryTraces({ ...flags, limit: 1 });
    const traceItems = capturedEnvelope<{ items: Array<{ traceId: string }> }>()
      .data.items;
    expect(traceItems.length).toBeGreaterThan(0);
    const traceId = traceItems[0]!.traceId;
    stdoutChunks = [];
    await runTraceGet({ ...flags, traceId });
    const data = expectOk<{ traceId: string }>('trace get');
    expect(data.traceId).toBe(traceId);
  });

  it('correlate trace: returns correlated signals envelope', async () => {
    await runQueryTraces({ ...flags, limit: 1 });
    const correlateItems = capturedEnvelope<{
      items: Array<{ traceId: string }>;
    }>().data.items;
    expect(correlateItems.length).toBeGreaterThan(0);
    const traceId = correlateItems[0]!.traceId;
    stdoutChunks = [];
    await runCorrelate({ ...flags, traceId });
    const env = capturedEnvelope();
    expect(env.ok).toBe(true);
    expect(env.command).toBe('correlate trace');
    expect(env.data).toBeDefined();
  });

  it('llm usage: returns summary + byModel + byService', async () => {
    await runLlmUsage(flags);
    const data = expectOk<{
      summary: { totalRequests: number };
      byModel: unknown;
      byService: unknown;
    }>('llm usage');
    expect(data.summary.totalRequests).toBeTypeOf('number');
    expect(data.byModel).toBeDefined();
    expect(data.byService).toBeDefined();
  });

  it('score explain: returns guide (no backend)', async () => {
    await runScoreExplain({});
    const data = expectOk<{ guide: string }>('score explain');
    expect(data.guide).toBeTypeOf('string');
    expect(data.guide.length).toBeGreaterThan(0);
  });
});
