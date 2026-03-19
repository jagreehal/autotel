import { describe, it, expect } from 'vitest';
import type { TerminalSpanEvent } from '../span-stream';
import { computeServiceStats, computeRouteStats, findHotSpanNames } from './stats-model';

const span = (overrides: Partial<TerminalSpanEvent> = {}): TerminalSpanEvent => ({
  name: 'op',
  spanId: 's',
  traceId: 't',
  startTime: 0,
  endTime: 1,
  durationMs: 1,
  status: 'OK',
  kind: 'INTERNAL',
  attributes: {},
  ...overrides,
});

describe('stats-model', () => {
  it('computes per-service stats', () => {
    const spans: TerminalSpanEvent[] = [
      span({ durationMs: 10, attributes: { 'service.name': 'api' } }),
      span({ durationMs: 30, attributes: { 'service.name': 'api' }, status: 'ERROR' }),
      span({ durationMs: 5, attributes: { 'service.name': 'worker' } }),
    ];

    const stats = computeServiceStats(spans);
    const api = stats.find((s) => s.serviceName === 'api')!;
    const worker = stats.find((s) => s.serviceName === 'worker')!;

    expect(api.total).toBe(2);
    expect(api.errors).toBe(1);
    expect(api.avgMs).toBeCloseTo(20);

    expect(worker.total).toBe(1);
    expect(worker.errors).toBe(0);
  });

  it('finds hot span names by p95', () => {
    const spans: TerminalSpanEvent[] = [
      span({ name: 'fast', durationMs: 5 }),
      span({ name: 'fast', durationMs: 10 }),
      span({ name: 'slow', durationMs: 100 }),
      span({ name: 'slow', durationMs: 120 }),
    ];

    const hot = findHotSpanNames(spans, 1);
    expect(hot).toHaveLength(1);
    expect(hot[0]!.name).toBe('slow');
    expect(hot[0]!.p95Ms).toBeGreaterThan(hot[0]!.avgMs);
  });

  it('computes per-route stats from http.route spans', () => {
    const spans: TerminalSpanEvent[] = [
      span({
        durationMs: 10,
        attributes: { 'http.route': '/users', 'service.name': 'api' },
      }),
      span({
        durationMs: 30,
        status: 'ERROR',
        attributes: { 'http.route': '/users', 'service.name': 'api' },
      }),
      span({
        durationMs: 5,
        attributes: { 'http.route': '/health', 'service.name': 'api' },
      }),
      span({
        durationMs: 99,
        attributes: { 'service.name': 'db' },
      }),
    ];

    const stats = computeRouteStats(spans);
    const users = stats.find((s) => s.route === '/users')!;
    const health = stats.find((s) => s.route === '/health')!;

    expect(users.total).toBe(2);
    expect(users.errors).toBe(1);
    expect(users.avgMs).toBeCloseTo(20);

    expect(health.total).toBe(1);
    expect(health.errors).toBe(0);
  });
});

