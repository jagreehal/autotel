import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  updateWidgetData,
  clearAllData,
  sortedTracesSignal,
  sortedLogsSignal,
  windowedTracesSignal,
  timeWindowSignal,
  tracesSignal,
  windowedErrorGroupsSignal,
  errorGroupsSignal,
  flowCountSignal,
  selectedTraceSignal,
  setSelectedTrace,
  storeTracesSignal,
  workingSetStatusSignal,
  selectAllTraces,
  selectedTraceIdsSignal,
  toggleTraceSelection,
  deleteSelectedTraces,
} from '../store.svelte';
import {
  makeTrace,
  makeLog,
  makeSpan,
} from '../../server/__tests__/test-utils/stubs';
import type { SpanData, TraceData } from '../types';

describe('Widget Store', () => {
  beforeEach(() => {
    clearAllData();
    storeTracesSignal.value = [];
    workingSetStatusSignal.value = 'pending';
    selectedTraceIdsSignal.value = new Set();
  });

  it('opens a trace loaded from the durable working set', () => {
    const stored = makeTrace({ traceId: 'stored-trace' });
    storeTracesSignal.value = [stored];
    workingSetStatusSignal.value = 'ready';

    setSelectedTrace('stored-trace');

    expect(selectedTraceSignal.value?.traceId).toBe('stored-trace');
  });

  it('selects traces loaded from the durable working set', () => {
    storeTracesSignal.value = [makeTrace({ traceId: 'stored-trace' })];
    workingSetStatusSignal.value = 'ready';

    selectAllTraces();

    expect([...selectedTraceIdsSignal.value]).toEqual(['stored-trace']);
  });

  it('removes a deleted trace from the durable working set', () => {
    storeTracesSignal.value = [makeTrace({ traceId: 'stored-trace' })];
    workingSetStatusSignal.value = 'ready';
    toggleTraceSelection('stored-trace');

    deleteSelectedTraces();

    expect(storeTracesSignal.value).toEqual([]);
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
      storeTracesSignal.value = [trace];
      workingSetStatusSignal.value = 'ready';
      toggleTraceSelection('t1');

      clearAllData();

      expect(sortedTracesSignal.value).toHaveLength(0);
      expect(sortedLogsSignal.value).toHaveLength(0);
      expect(storeTracesSignal.value).toHaveLength(0);
      expect(selectedTraceIdsSignal.value.size).toBe(0);
    });
  });
});

describe('windowedTracesSignal', () => {
  /**
   * Every view derived from traces reads this rather than the raw list. A view
   * that ignores the window is worse than one without a window at all: the
   * control says the range is narrowed and the screen disagrees.
   */
  const NOW = Date.now();

  function traceAt(id: string, startTime: number, spanCount = 1): TraceData {
    const spans: SpanData[] = Array.from({ length: spanCount }, (_, index) => ({
      spanId: `s-${id}-${index}`,
      traceId: id,
      parentSpanId: index === 0 ? undefined : `s-${id}-0`,
      name: 'op',
      kind: 'INTERNAL',
      startTime,
      endTime: startTime + 1,
      duration: 1,
      attributes: {},
      status: { code: 'UNSET' },
      events: [],
    }));
    return {
      traceId: id,
      correlationId: id,
      spans,
      rootSpan: spans[0],
      startTime,
      endTime: startTime + 1,
      duration: 1,
      status: 'OK',
      service: 'api',
    };
  }

  beforeEach(() => {
    timeWindowSignal.value = { type: 'preset', preset: 'all' };
    tracesSignal.value = [
      traceAt('recent', NOW - 60_000),
      traceAt('old', NOW - 60 * 60_000),
    ];
  });

  afterEach(() => {
    timeWindowSignal.value = { type: 'preset', preset: 'all' };
    tracesSignal.value = [];
  });

  it('passes everything through for the unbounded default', () => {
    expect(windowedTracesSignal.value).toHaveLength(2);
  });

  it('drops traces outside a bounded window', () => {
    timeWindowSignal.value = { type: 'preset', preset: '15m' };
    expect(windowedTracesSignal.value.map((t) => t.traceId)).toEqual([
      'recent',
    ]);
  });

  it('honours an explicit custom window', () => {
    timeWindowSignal.value = {
      type: 'custom',
      start: NOW - 2 * 60 * 60_000,
      end: NOW - 30 * 60_000,
    };
    expect(windowedTracesSignal.value.map((t) => t.traceId)).toEqual(['old']);
  });

  it('returns nothing when the window excludes everything', () => {
    // Empty is a finding, not a rendering problem — it must not fall back to
    // showing the full list.
    timeWindowSignal.value = {
      type: 'custom',
      start: NOW + 60_000,
      end: NOW + 120_000,
    };
    expect(windowedTracesSignal.value).toEqual([]);
  });

  it('counts flow traces only inside the selected window', () => {
    tracesSignal.value = [
      traceAt('recent', NOW - 60_000),
      traceAt('old-flow', NOW - 60 * 60_000, 2),
    ];
    timeWindowSignal.value = { type: 'preset', preset: '15m' };

    expect(flowCountSignal.value).toBe(0);
  });
});

describe('windowedErrorGroupsSignal', () => {
  /**
   * An error group spans a range rather than sitting at an instant, so the
   * window test is **overlap**. Testing `firstSeen` alone would hide an error
   * that started before the window and is still happening — which is exactly
   * the one you opened the tab to find.
   */
  const NOW = Date.now();

  function group(fingerprint: string, firstSeen: number, lastSeen: number) {
    return {
      fingerprint,
      type: 'Error',
      message: 'boom',
      count: 1,
      firstSeen,
      lastSeen,
      affectedTraces: [],
      affectedSpans: [],
    };
  }

  beforeEach(() => {
    timeWindowSignal.value = { type: 'preset', preset: 'all' };
  });

  afterEach(() => {
    timeWindowSignal.value = { type: 'preset', preset: 'all' };
    errorGroupsSignal.value = [];
  });

  it('passes everything through for the unbounded default', () => {
    errorGroupsSignal.value = [
      group('a', NOW - 60 * 60_000, NOW - 60 * 60_000),
    ];
    expect(windowedErrorGroupsSignal.value).toHaveLength(1);
  });

  it('keeps a group that started before the window but is still happening', () => {
    errorGroupsSignal.value = [group('ongoing', NOW - 60 * 60_000, NOW)];
    timeWindowSignal.value = { type: 'preset', preset: '15m' };
    expect(windowedErrorGroupsSignal.value.map((g) => g.fingerprint)).toEqual([
      'ongoing',
    ]);
  });

  it('drops a group that finished before the window', () => {
    errorGroupsSignal.value = [
      group('old', NOW - 120 * 60_000, NOW - 60 * 60_000),
    ];
    timeWindowSignal.value = { type: 'preset', preset: '15m' };
    expect(windowedErrorGroupsSignal.value).toEqual([]);
  });

  it('drops a group that starts after the window ends', () => {
    errorGroupsSignal.value = [group('future', NOW + 60_000, NOW + 120_000)];
    timeWindowSignal.value = {
      type: 'custom',
      start: NOW - 60_000,
      end: NOW,
    };
    expect(windowedErrorGroupsSignal.value).toEqual([]);
  });
});
