import { describe, expect, it } from 'vitest';
import {
  appendManyWithLimit,
  appendWithLimit,
  resolveTelemetryLimits,
} from '../telemetry-limits';
import { DevtoolsServer } from '../server';
import { makeTrace, makeLog } from './test-utils/stubs';

describe('resolveTelemetryLimits', () => {
  it('resolves per-signal limits from env with maxHistory fallback', () => {
    const limits = resolveTelemetryLimits({
      maxHistory: 25,
      env: {
        AUTOTEL_MAX_TRACE_COUNT: '10',
        AUTOTEL_MAX_LOG_COUNT: '11',
        AUTOTEL_MAX_METRIC_COUNT: '12',
      } as NodeJS.ProcessEnv,
    });

    expect(limits).toEqual({
      maxTraceCount: 10,
      maxLogCount: 11,
      maxMetricCount: 12,
    });
  });

  it('uses maxHistory when env vars not set', () => {
    const limits = resolveTelemetryLimits({
      maxHistory: 50,
      env: {} as NodeJS.ProcessEnv,
    });

    expect(limits).toEqual({
      maxTraceCount: 50,
      maxLogCount: 50,
      maxMetricCount: 50,
    });
  });

  it('uses default limit when nothing specified', () => {
    const limits = resolveTelemetryLimits({
      env: {} as NodeJS.ProcessEnv,
    });

    expect(limits.maxTraceCount).toBe(100);
    expect(limits.maxLogCount).toBe(100);
    expect(limits.maxMetricCount).toBe(100);
  });

  it('ignores invalid env values', () => {
    const limits = resolveTelemetryLimits({
      maxHistory: 25,
      env: {
        AUTOTEL_MAX_TRACE_COUNT: 'invalid',
        AUTOTEL_MAX_LOG_COUNT: '-5',
        AUTOTEL_MAX_METRIC_COUNT: '0',
      } as NodeJS.ProcessEnv,
    });

    expect(limits.maxTraceCount).toBe(25);
    expect(limits.maxLogCount).toBe(25);
    expect(limits.maxMetricCount).toBe(25);
  });
});

describe('appendWithLimit', () => {
  it('appends items while keeping the newest entries within the limit', () => {
    expect(appendWithLimit([1, 2], 3, 2)).toEqual([2, 3]);
    expect(appendWithLimit([1], 2, 3)).toEqual([1, 2]);
  });

  it('returns empty array when limit is zero', () => {
    expect(appendWithLimit([1, 2, 3], 4, 0)).toEqual([]);
  });

  it('handles limit of one', () => {
    expect(appendWithLimit([1, 2, 3], 4, 1)).toEqual([4]);
  });
});

describe('appendManyWithLimit', () => {
  it('appends multiple items while respecting limit', () => {
    expect(appendManyWithLimit([1, 2], [3, 4], 3)).toEqual([2, 3, 4]);
    expect(appendManyWithLimit([1], [2, 3], 5)).toEqual([1, 2, 3]);
  });

  it('handles empty incoming array', () => {
    expect(appendManyWithLimit([1, 2], [], 5)).toEqual([1, 2]);
    expect(appendManyWithLimit([1, 2], [], 0)).toEqual([]);
  });

  it('handles limit of zero', () => {
    expect(appendManyWithLimit([1, 2], [3, 4], 0)).toEqual([]);
  });
});

describe('telemetry limits in DevtoolsServer', () => {
  it('applies separate limits for traces and logs', async () => {
    const server = new DevtoolsServer({
      port: 0,
      maxTraceCount: 2,
      maxLogCount: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    server.addTrace(makeTrace({ traceId: 't1' }));
    server.addTrace(makeTrace({ traceId: 't2' }));
    server.addTrace(makeTrace({ traceId: 't3' }));

    server.addLog(makeLog({ id: 'l1' }));
    server.addLog(makeLog({ id: 'l2' }));

    const current = server.getCurrentData();
    expect(current.traces.map((t) => t.traceId)).toEqual(['t2', 't3']);
    expect(current.logs.map((l) => l.id)).toEqual(['l2']);

    await server.close();
  });
});
