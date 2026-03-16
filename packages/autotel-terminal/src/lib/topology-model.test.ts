import { describe, it, expect } from 'vitest';
import type { TerminalSpanEvent } from '../span-stream';
import { buildServiceGraph } from './topology-model';

const baseSpan = (overrides: Partial<TerminalSpanEvent> = {}): TerminalSpanEvent => ({
  name: 'span',
  spanId: 'span-id',
  traceId: 'trace-id',
  startTime: 0,
  endTime: 10,
  durationMs: 10,
  status: 'OK',
  kind: 'INTERNAL',
  attributes: {},
  ...overrides,
});

describe('buildServiceGraph', () => {
  it('builds single service with no edges', () => {
    const spans: TerminalSpanEvent[] = [
      baseSpan({
        durationMs: 50,
        attributes: { 'service.name': 'api' },
      }),
      baseSpan({
        durationMs: 150,
        attributes: { 'service.name': 'api' },
      }),
    ];

    const graph = buildServiceGraph(spans);
    expect(graph.services).toHaveLength(1);
    expect(graph.edges).toHaveLength(0);

    const svc = graph.services[0]!;
    expect(svc.serviceName).toBe('api');
    expect(svc.spanCount).toBe(2);
    expect(svc.errorCount).toBe(0);
    expect(svc.avgDurationMs).toBeCloseTo(100);
  });

  it('derives edges from client spans with peer service attributes', () => {
    const spans: TerminalSpanEvent[] = [
      baseSpan({
        name: 'http request',
        durationMs: 20,
        attributes: { 'service.name': 'api' },
      }),
      baseSpan({
        name: 'db query',
        durationMs: 5,
        status: 'ERROR',
        kind: 'CLIENT',
        attributes: {
          'service.name': 'api',
          'db.system': 'postgresql',
        },
      }),
      baseSpan({
        name: 'queue publish',
        durationMs: 10,
        kind: 'CLIENT',
        attributes: {
          'service.name': 'api',
          'messaging.system': 'kafka',
        },
      }),
    ];

    const graph = buildServiceGraph(spans);
    expect(graph.services.map((service) => service.serviceName).toSorted()).toEqual(
      ['api'],
    );

    // Edges: api -> postgresql, api -> kafka
    expect(graph.edges).toHaveLength(2);
    const edgeKeys = graph.edges
      .map((edge) => `${edge.fromService}->${edge.toService}`)
      .toSorted();
    expect(edgeKeys).toEqual(['api->kafka', 'api->postgresql']);

    const dbEdge = graph.edges.find((e) => e.toService === 'postgresql')!;
    expect(dbEdge.spanCount).toBe(1);
    expect(dbEdge.errorCount).toBe(1);
  });

  it('falls back to unknown service when service.name missing', () => {
    const spans: TerminalSpanEvent[] = [
      baseSpan({
        durationMs: 30,
        attributes: {},
      }),
    ];

    const graph = buildServiceGraph(spans);
    expect(graph.services).toHaveLength(1);
    expect(graph.services[0]!.serviceName).toBe('unknown');
  });
});

