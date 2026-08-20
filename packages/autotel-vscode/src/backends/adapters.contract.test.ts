import { describe, it, expect } from 'vitest';
import { listAdapters, getAdapter } from './types';
// Force registration of every adapter.
import './jaeger';
import './tempo';
import './honeycomb';
import './datadog';
import './logfire';
import './signoz';

describe('backend adapter registry', () => {
  it('registers every shipped adapter', () => {
    const ids = listAdapters()
      .map((a) => a.id)
      .sort();
    expect(ids).toEqual([
      'datadog',
      'honeycomb',
      'jaeger',
      'logfire',
      'signoz',
      'tempo',
    ]);
  });

  it('each adapter implements the QueryAdapter interface', () => {
    for (const a of listAdapters()) {
      expect(a.id).toBeTypeOf('string');
      expect(a.label).toBeTypeOf('string');
      expect(a.ping).toBeTypeOf('function');
      expect(a.listServices).toBeTypeOf('function');
      expect(a.searchTraces).toBeTypeOf('function');
      expect(a.getTrace).toBeTypeOf('function');
    }
  });

  it('getAdapter resolves by id', () => {
    expect(getAdapter('jaeger')?.label).toBe('Jaeger');
    expect(getAdapter('tempo')?.label).toBe('Grafana Tempo');
    expect(getAdapter('honeycomb')?.label).toBe('Honeycomb');
    expect(getAdapter('datadog')?.label).toBe('Datadog APM');
    expect(getAdapter('logfire')?.label).toBe('Pydantic Logfire');
    expect(getAdapter('signoz')?.label).toBe('SigNoz');
    expect(getAdapter('nope')).toBeUndefined();
  });
});
