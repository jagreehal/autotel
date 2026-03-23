import { describe, it, expect } from 'vitest';
import type { TerminalSpanEvent } from '../span-stream';
import { deriveAvailableFilters, applySpanFilters } from './filters';

const span = (
  overrides: Partial<TerminalSpanEvent> = {},
): TerminalSpanEvent => ({
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

describe('filters', () => {
  const spans: TerminalSpanEvent[] = [
    span({
      name: 'GET /users',
      status: 'OK',
      attributes: {
        'service.name': 'api',
        'http.route': '/users',
        'http.status_code': 200,
      },
    }),
    span({
      name: 'GET /users/:id',
      status: 'ERROR',
      attributes: {
        'service.name': 'api',
        'http.route': '/users/:id',
        'http.status_code': 500,
      },
    }),
    span({
      name: 'SELECT users',
      attributes: {
        'service.name': 'db',
        'db.system': 'postgresql',
      },
    }),
  ];

  it('derives available filters from spans', () => {
    const filters = deriveAvailableFilters(spans);
    expect(filters.serviceNames.toSorted()).toEqual(['api', 'db']);
    expect(filters.routes.toSorted()).toEqual(['/users', '/users/:id']);
    expect(filters.statusCodes).toEqual([200, 500]);
  });

  it('applies service, route, status and error filters', () => {
    const onlyApi = applySpanFilters(spans, { serviceName: 'api' });
    expect(onlyApi).toHaveLength(2);

    const onlyRoute = applySpanFilters(spans, { route: '/users' });
    expect(onlyRoute).toHaveLength(1);
    expect(onlyRoute[0]!.attributes!['http.route']).toBe('/users');

    const only5xx = applySpanFilters(spans, { statusGroup: '5xx' });
    expect(only5xx).toHaveLength(1);
    expect(only5xx[0]!.attributes!['http.status_code']).toBe(500);

    const errorsOnly = applySpanFilters(spans, { errorsOnly: true });
    expect(errorsOnly).toHaveLength(1);
    expect(errorsOnly[0]!.status).toBe('ERROR');
  });

  it('applies search over name and attributes', () => {
    const byName = applySpanFilters(spans, { searchQuery: 'select' });
    expect(byName).toHaveLength(1);
    expect(byName[0]!.name).toContain('SELECT');

    const byAttr = applySpanFilters(spans, { searchQuery: 'postgresql' });
    expect(byAttr).toHaveLength(1);
    expect(byAttr[0]!.attributes!['db.system']).toBe('postgresql');
  });

  it('filters spans by traceId', () => {
    const spansWithTraces = [
      span({ name: 'op-a', traceId: 'trace-1' }),
      span({ name: 'op-b', traceId: 'trace-2' }),
      span({ name: 'op-c', traceId: 'trace-1' }),
    ];
    const result = applySpanFilters(spansWithTraces, { traceId: 'trace-1' });
    expect(result).toHaveLength(2);
    expect(result.every((s) => s.traceId === 'trace-1')).toBe(true);
  });

  it('composes traceId filter with other filters', () => {
    const spansWithTraces = [
      span({ name: 'op-a', traceId: 'trace-1', status: 'OK' }),
      span({ name: 'op-b', traceId: 'trace-1', status: 'ERROR' }),
      span({ name: 'op-c', traceId: 'trace-2', status: 'ERROR' }),
    ];
    const result = applySpanFilters(spansWithTraces, {
      traceId: 'trace-1',
      errorsOnly: true,
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('op-b');
  });
});
