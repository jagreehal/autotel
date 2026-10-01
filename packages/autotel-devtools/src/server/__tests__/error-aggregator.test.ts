import { describe, it, expect } from 'vitest';
import { ErrorAggregator } from '../error-aggregator';
import { makeTrace, makeErrorTrace, makeSpan } from './test-utils/stubs';
import type { LogData, SpanData } from '../types';

const failing = (overrides: Partial<SpanData> = {}) =>
  makeSpan({ status: { code: 'ERROR', message: 'fail' }, ...overrides });

const traceOf = (traceId: string, spans: SpanData[]) =>
  makeTrace({
    traceId,
    status: 'ERROR',
    rootSpan: spans[0],
    spans: spans.map((s) => ({ ...s, traceId })),
  });

const exceptionEvent = (attributes: Record<string, string>) => ({
  name: 'exception',
  timestamp: 150,
  attributes,
});

describe('ErrorAggregator', () => {
  it('groups failures by the shared issue fingerprint', () => {
    const agg = new ErrorAggregator();
    const stack = 'Error: fail\n    at foo (/app/src/app.ts:1:1)';
    const span = failing({ attributes: { 'exception.stacktrace': stack } });
    const first = agg.addTrace(traceOf('t1', [span]))!;
    const second = agg.addTrace(traceOf('t2', [span]))!;
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.count).toBe(2);
    expect(second.affectedTraces).toEqual(['t1', 't2']);
  });

  it('groups stackless errors that differ only in a number with a unit suffix', () => {
    // Without a stack the normalised message is the fingerprint, so durations
    // have to normalise for repeats to share a group.
    const agg = new ErrorAggregator();
    const timeout = (ms: number) =>
      failing({
        status: { code: 'ERROR', message: `upstream timed out after ${ms}ms` },
        attributes: { 'exception.type': 'TimeoutError' },
      });
    agg.addTrace(traceOf('t1', [timeout(37)]));
    agg.addTrace(traceOf('t2', [timeout(412)]));
    expect(agg.getErrorGroups()).toHaveLength(1);
  });

  it('keeps different error types apart', () => {
    const agg = new ErrorAggregator();
    agg.addTrace(
      traceOf('t1', [
        failing({ attributes: { 'exception.type': 'TypeError' } }),
      ]),
    );
    agg.addTrace(
      traceOf('t2', [
        failing({ attributes: { 'exception.type': 'RangeError' } }),
      ]),
    );
    expect(agg.getErrorGroups()).toHaveLength(2);
  });

  it('reads type and message from the exception event, falling back sensibly', () => {
    const agg = new ErrorAggregator();
    expect(agg.addTrace(makeErrorTrace('t1', 'something broke'))).toMatchObject(
      {
        type: 'Error',
        message: 'something broke',
        source: 'exception',
      },
    );
    expect(
      agg.addTrace(
        traceOf('t2', [
          failing({ status: { code: 'ERROR', message: 'internal error' } }),
        ]),
      ),
    ).toMatchObject({ type: 'Error', message: 'internal error' });
    expect(
      agg.addTrace(
        traceOf('t3', [
          failing({
            status: { code: 'ERROR', message: '' },
            events: [
              exceptionEvent({
                'exception.type': 'TypeError',
                'exception.message': 'x is not a function',
              }),
            ],
          }),
        ]),
      ),
    ).toMatchObject({ type: 'TypeError', message: 'x is not a function' });
    // An empty message falls back to the type, not "Unknown error".
    expect(
      agg.addTrace(
        traceOf('t4', [
          failing({
            status: { code: 'ERROR', message: '' },
            events: [
              exceptionEvent({
                'exception.type': 'ValidationError',
                'exception.message': '',
              }),
            ],
          }),
        ]),
      ),
    ).toMatchObject({ type: 'ValidationError', message: 'ValidationError' });
    expect(agg.addTrace(makeTrace({ traceId: 'ok' }))).toBeUndefined();
  });

  it('shows what the Issues store records, not only failed spans', () => {
    const agg = new ErrorAggregator();
    const ok = (traceId: string, attributes: Record<string, string>) =>
      traceOf(traceId, [makeSpan({ events: [exceptionEvent(attributes)] })]);
    agg.addTrace(
      ok('h', {
        'exception.type': 'Error',
        'exception.message': 'fallback used',
      }),
    );
    agg.addTrace(
      ok('f', {
        'exception.type': 'autotel.LogFlood',
        'exception.message': '"x" logged 100+ times in one invocation',
      }),
    );
    agg.addTrace(
      ok('a', {
        'exception.type': 'autotel.RunawayAlarm',
        'exception.message': 'alarm loop',
      }),
    );
    agg.addTrace(
      traceOf('5', [
        makeSpan({ attributes: { 'http.response.status_code': 503 } }),
      ]),
    );
    const log: LogData = {
      id: 'l1',
      body: 'queue consumer crashed',
      timestamp: 300,
      severityText: 'ERROR',
      severityNumber: 17,
      resourceName: 'worker',
    };
    agg.addLog(log);
    agg.addLog({ ...log, id: 'l2', traceId: 'in-a-trace' }); // the trace is the failure
    expect(
      agg
        .getErrorGroups()
        .map((g) => [g.source, g.type])
        .sort(),
    ).toEqual([
      ['error_log', 'Error log'],
      ['handled_exception', 'Error'],
      ['http_5xx', 'HTTP 5xx'],
      ['log_flood', 'autotel.LogFlood'],
      ['runaway_alarm', 'autotel.RunawayAlarm'],
    ]);
  });

  it('counts a trace once as it grows, and moves it when the throw site arrives', () => {
    const agg = new ErrorAggregator();
    const root = makeSpan({
      spanId: 'root',
      attributes: { 'http.response.status_code': 500 },
    });
    agg.addTrace(traceOf('t1', [root]));
    agg.addTrace(traceOf('t1', [root])); // exporter retry
    expect(agg.getErrorGroups()).toMatchObject([
      { source: 'http_5xx', count: 1 },
    ]);

    const leaf = failing({
      spanId: 'leaf',
      parentSpanId: 'root',
      attributes: {
        'exception.type': 'TypeError',
        'exception.stacktrace':
          'TypeError: nope\n    at charge (/app/src/pay.ts:3:9)',
      },
    });
    agg.addTrace(traceOf('t1', [root, leaf]));
    expect(agg.getErrorGroups()).toMatchObject([
      { source: 'exception', type: 'TypeError', count: 1 },
    ]);
  });

  it('counts one failure per trace, not one per span it unwound through', () => {
    const agg = new ErrorAggregator();
    const stack = 'TypeError: nope\n    at charge (/app/src/pay.ts:3:9)';
    const at = (spanId: string, parentSpanId?: string) =>
      failing({
        spanId,
        parentSpanId,
        attributes: {
          'exception.type': 'TypeError',
          'exception.stacktrace': stack,
        },
      });
    for (const traceId of ['t1', 't2']) {
      agg.addTrace(
        traceOf(traceId, [at('root'), at('mid', 'root'), at('leaf', 'mid')]),
      );
    }
    expect(agg.getErrorGroups()).toMatchObject([{ count: 2 }]);
  });

  it('keeps first/last seen as bounds when batches arrive out of order', () => {
    const agg = new ErrorAggregator();
    agg.addTrace(traceOf('new', [failing({ startTime: 2000 })]));
    const group = agg.addTrace(traceOf('old', [failing({ startTime: 1000 })]))!;
    expect(group.firstSeen).toBe(1000);
    expect(group.lastSeen).toBe(2000);
  });

  it('groups by an emitted exception.fingerprint even when stacks differ', () => {
    const agg = new ErrorAggregator();
    const withStack = (traceId: string, line: number) =>
      traceOf(traceId, [
        failing({
          attributes: {
            'exception.fingerprint': 'sdk-decided',
            'exception.stacktrace': `Error: x\n    at f${line} (/app/src/a.ts:${line}:1)`,
          },
        }),
      ]);
    agg.addTrace(withStack('t1', 1));
    agg.addTrace(withStack('t2', 2));
    expect(agg.getErrorGroups()).toMatchObject([
      { fingerprint: 'sdk-decided', count: 2 },
    ]);
  });

  it('reads a stack written as error.stack', () => {
    const agg = new ErrorAggregator();
    const group = agg.addTrace(
      traceOf('t1', [
        failing({
          attributes: {
            'error.stack': 'Error: x\n    at boom (/app/src/b.ts:2:1)',
          },
        }),
      ]),
    )!;
    expect(group.stackTrace).toContain('at boom');
    expect(group.attributes?.['code.function']).toBe('boom (b.ts)');
  });

  it('evicts the least recently seen group past maxGroups, and clears', () => {
    const agg = new ErrorAggregator({ maxGroups: 2 });
    for (const [i, type] of ['A', 'B', 'C'].entries()) {
      agg.addTrace(
        traceOf(`t${i}`, [
          failing({ startTime: i, attributes: { 'exception.type': type } }),
        ]),
      );
    }
    expect(agg.getErrorGroups().map((g) => g.type)).toEqual(['C', 'B']);
    agg.clear();
    expect(agg.getErrorGroups()).toEqual([]);
  });
});
