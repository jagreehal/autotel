/**
 * Service map edges.
 *
 * An edge is a call from one service to another. Instrumented HTTP marks the
 * two sides CLIENT and SERVER, but a service that forwards trace context by
 * hand produces INTERNAL spans whose parent lives in the caller. Both are
 * calls, and a map that draws only the first shows three islands for one
 * request.
 */

import { describe, it, expect } from 'vitest';
import { buildServiceMap } from './serviceMap';
import type { SpanData, TraceData } from '../types';

const span = (
  spanId: string,
  service: string,
  kind: SpanData['kind'],
  parentSpanId?: string,
): SpanData => ({
  traceId: 't1',
  spanId,
  parentSpanId,
  name: `${service}.work`,
  kind,
  startTime: 0,
  endTime: 10,
  duration: 10,
  attributes: { 'service.name': service },
  status: { code: 'OK' },
});

const trace = (spans: SpanData[]): TraceData => ({
  traceId: 't1',
  correlationId: 't1',
  rootSpan: spans[0],
  spans,
  startTime: 0,
  endTime: 10,
  duration: 10,
  status: 'OK',
  service: 'atm',
});

const edges = (spans: SpanData[]) =>
  buildServiceMap([trace(spans)])
    .connections.map((c) => `${c.source}->${c.target} x${c.requestCount}`)
    .sort();

describe('buildServiceMap edges', () => {
  it('connects services whose INTERNAL spans share a trace', () => {
    expect(
      edges([
        span('a', 'atm', 'INTERNAL'),
        span('b', 'auth-service', 'INTERNAL', 'a'),
        span('c', 'auth-service', 'INTERNAL', 'a'),
        span('d', 'accounts-service', 'INTERNAL', 'a'),
      ]),
    ).toEqual(['atm->accounts-service x1', 'atm->auth-service x2']);
  });

  it('counts a CLIENT to SERVER call once', () => {
    expect(
      edges([
        span('a', 'atm', 'CLIENT'),
        span('b', 'auth-service', 'SERVER', 'a'),
      ]),
    ).toEqual(['atm->auth-service x1']);
  });

  it('draws no edge within one service', () => {
    expect(
      edges([span('a', 'atm', 'INTERNAL'), span('b', 'atm', 'INTERNAL', 'a')]),
    ).toEqual([]);
  });
});
