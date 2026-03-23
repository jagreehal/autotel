import { describe, it, expect } from 'vitest';
import type { TraceSummary } from './trace-model';
import { buildErrorSummaries } from './error-model';

const trace = (overrides: Partial<TraceSummary> = {}): TraceSummary => ({
  traceId: 't',
  rootName: 'root',
  durationMs: 10,
  hasError: false,
  spanCount: 1,
  lastEndTime: 1000,
  spans: [],
  ...overrides,
});

describe('buildErrorSummaries', () => {
  it('returns only traces that contain error spans', () => {
    const traces: TraceSummary[] = [
      trace({
        traceId: 'ok',
        lastEndTime: 1,
        spans: [
          {
            name: 'a',
            spanId: '1',
            traceId: 'ok',
            startTime: 0,
            endTime: 1,
            durationMs: 1,
            status: 'OK',
          },
        ],
      }),
      trace({
        traceId: 'err',
        rootName: 'GET /users',
        lastEndTime: 5,
        spans: [
          {
            name: 'a',
            spanId: '1',
            traceId: 'err',
            startTime: 0,
            endTime: 1,
            durationMs: 1,
            status: 'OK',
            attributes: {
              'service.name': 'api',
              'http.route': '/users',
              'http.status_code': 500,
            },
          },
          {
            name: 'b',
            spanId: '2',
            traceId: 'err',
            startTime: 1,
            endTime: 2,
            durationMs: 1,
            status: 'ERROR',
          },
          {
            name: 'c',
            spanId: '3',
            traceId: 'err',
            startTime: 2,
            endTime: 3,
            durationMs: 1,
            status: 'ERROR',
          },
        ],
      }),
    ];

    const errors = buildErrorSummaries(traces);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.traceId).toBe('err');
    expect(errors[0]!.errorCount).toBe(2);
    expect(errors[0]!.serviceName).toBe('api');
    expect(errors[0]!.route).toBe('/users');
    expect(errors[0]!.statusCode).toBe(500);
  });

  it('sorts by most recent lastEndTime', () => {
    const traces: TraceSummary[] = [
      trace({
        traceId: 'a',
        lastEndTime: 10,
        spans: [
          {
            name: 'a',
            spanId: '1',
            traceId: 'a',
            startTime: 0,
            endTime: 1,
            durationMs: 1,
            status: 'ERROR',
          },
        ],
      }),
      trace({
        traceId: 'b',
        lastEndTime: 20,
        spans: [
          {
            name: 'b',
            spanId: '2',
            traceId: 'b',
            startTime: 0,
            endTime: 1,
            durationMs: 1,
            status: 'ERROR',
          },
        ],
      }),
    ];

    const errors = buildErrorSummaries(traces);
    expect(errors.map((e) => e.traceId)).toEqual(['b', 'a']);
  });
});
