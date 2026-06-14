import { describe, it, expect, beforeEach } from 'vitest';
import {
  updateWidgetData,
  clearAllData,
  sortedTracesSignal,
  sortedLogsSignal,
} from '../store.svelte';
import {
  makeTrace,
  makeLog,
  makeSpan,
} from '../../server/__tests__/test-utils/stubs';

describe('Widget Store', () => {
  beforeEach(() => {
    clearAllData();
  });

  describe('updateWidgetData - traces', () => {
    it('adds traces to empty store', () => {
      const trace = makeTrace({ traceId: 'trace-1' });

      updateWidgetData({ traces: [trace] });

      expect(sortedTracesSignal.value).toHaveLength(1);
      expect(sortedTracesSignal.value[0].traceId).toBe('trace-1');
    });

    it('merges new traces, keeping unique by traceId', () => {
      const trace1 = makeTrace({ traceId: 'trace-1' });
      const trace2 = makeTrace({ traceId: 'trace-2' });
      const trace3 = makeTrace({ traceId: 'trace-3' });

      updateWidgetData({ traces: [trace1, trace2] });
      updateWidgetData({ traces: [trace2, trace3] });

      expect(sortedTracesSignal.value).toHaveLength(3);
    });

    it('sorts traces by startTime (most recent first)', () => {
      const now = Date.now();
      const trace1 = makeTrace({ traceId: 't1', startTime: now - 1000 });
      const trace2 = makeTrace({ traceId: 't2', startTime: now - 100 });
      const trace3 = makeTrace({ traceId: 't3', startTime: now - 500 });

      updateWidgetData({ traces: [trace1, trace2, trace3] });

      const traces = sortedTracesSignal.value;
      expect(traces[0].traceId).toBe('t2'); // most recent
      expect(traces[1].traceId).toBe('t3');
      expect(traces[2].traceId).toBe('t1'); // oldest
    });

    it('merges late-arriving spans into an existing trace', () => {
      const root = makeSpan({
        traceId: 'm1',
        spanId: 'root',
        name: 'POST /checkout',
      });
      const child = makeSpan({
        traceId: 'm1',
        spanId: 'child',
        name: 'POST /validate',
        parentSpanId: 'root',
      });

      // First batch carries only the root span...
      updateWidgetData({
        traces: [makeTrace({ traceId: 'm1', rootSpan: root, spans: [root] })],
      });
      // ...a later batch (e.g. a downstream service) adds more spans.
      updateWidgetData({
        traces: [makeTrace({ traceId: 'm1', rootSpan: child, spans: [child] })],
      });

      const trace = sortedTracesSignal.value.find((t) => t.traceId === 'm1');
      expect(trace?.spans).toHaveLength(2);
      expect(trace?.rootSpan.spanId).toBe('root');
    });

    it('recovers the real root when downstream spans arrive first', () => {
      const child = makeSpan({
        traceId: 'm2',
        spanId: 'child',
        name: 'POST /validate',
        parentSpanId: 'root',
      });
      const root = makeSpan({
        traceId: 'm2',
        spanId: 'root',
        name: 'POST /checkout',
        attributes: { 'service.name': 'shop-api' },
      });

      // Downstream-only batch arrives before the parentless root span...
      updateWidgetData({
        traces: [
          makeTrace({
            traceId: 'm2',
            rootSpan: child,
            spans: [child],
            service: 'shop-auth',
          }),
        ],
      });
      // ...then the root batch lands and should take over.
      updateWidgetData({
        traces: [makeTrace({ traceId: 'm2', rootSpan: root, spans: [root] })],
      });

      const trace = sortedTracesSignal.value.find((t) => t.traceId === 'm2');
      expect(trace?.spans).toHaveLength(2);
      expect(trace?.rootSpan.spanId).toBe('root');
      expect(trace?.service).toBe('shop-api');
    });
  });

  describe('updateWidgetData - logs', () => {
    it('adds logs to store', () => {
      const log = makeLog({ id: 'log-1', body: 'Test message' });

      updateWidgetData({ logs: [log] });

      expect(sortedLogsSignal.value).toHaveLength(1);
    });

    it('limits log history to 100 entries', () => {
      const base = Date.now();
      const logs = Array.from({ length: 150 }, (_, i) =>
        makeLog({ id: `log-${i}`, timestamp: base + i }),
      );

      updateWidgetData({ logs });

      expect(sortedLogsSignal.value).toHaveLength(100);
      // slice(0, 100) keeps the first 100 prepended entries (log-0..log-99); sort shows newest of those first
      expect(sortedLogsSignal.value[0].id).toBe('log-99');
    });

    it('sorts logs by timestamp (most recent first)', () => {
      const now = Date.now();
      const log1 = makeLog({ id: 'log-1', timestamp: now - 1000 });
      const log2 = makeLog({ id: 'log-2', timestamp: now - 100 });

      updateWidgetData({ logs: [log1, log2] });

      const logs = sortedLogsSignal.value;
      expect(logs[0].id).toBe('log-2'); // most recent
      expect(logs[1].id).toBe('log-1');
    });
  });

  describe('clearAllData', () => {
    it('clears all data', () => {
      const trace = makeTrace({ traceId: 't1' });
      const log = makeLog({ id: 'l1' });

      updateWidgetData({ traces: [trace], logs: [log] });

      clearAllData();

      expect(sortedTracesSignal.value).toHaveLength(0);
      expect(sortedLogsSignal.value).toHaveLength(0);
    });
  });
});
