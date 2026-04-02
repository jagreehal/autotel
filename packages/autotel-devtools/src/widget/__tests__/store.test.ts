import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '@preact/signals';
import {
  updateWidgetData,
  clearAllData,
  sortedTracesSignal,
  sortedLogsSignal,
} from '../store';
import type { TraceData, LogData } from '../types';
import { makeTrace, makeLog } from '../../server/__tests__/test-utils/stubs';

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
  });

  describe('updateWidgetData - logs', () => {
    it('adds logs to store', () => {
      const log = makeLog({ id: 'log-1', body: 'Test message' });

      updateWidgetData({ logs: [log] });

      expect(sortedLogsSignal.value).toHaveLength(1);
    });

    it('limits log history to 100 entries', () => {
      const logs = Array.from({ length: 150 }, (_, i) =>
        makeLog({ id: `log-${i}` }),
      );

      updateWidgetData({ logs });

      expect(sortedLogsSignal.value).toHaveLength(100);
      // Should keep most recent logs
      expect(sortedLogsSignal.value[0].id).toBe('log-149');
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
