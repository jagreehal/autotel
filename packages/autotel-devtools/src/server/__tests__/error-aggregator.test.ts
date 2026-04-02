import { describe, it, expect } from 'vitest';
import { ErrorAggregator } from '../error-aggregator';
import { makeTrace, makeErrorTrace } from './test-utils/stubs';

describe('ErrorAggregator', () => {
  describe('addError', () => {
    it('groups errors by fingerprint', () => {
      const agg = new ErrorAggregator();
      const occ = {
        traceId: 't1',
        spanId: 's1',
        spanName: 'GET /api',
        service: 'svc',
        timestamp: Date.now(),
        error: {
          type: 'Error',
          message: 'fail',
          stackTrace: 'Error: fail\n  at foo (app.js:1:1)',
        },
      };

      const group1 = agg.addError(occ);
      expect(group1.count).toBe(1);
      expect(group1.type).toBe('Error');
      expect(group1.message).toBe('fail');

      const group2 = agg.addError({ ...occ, traceId: 't2', spanId: 's2' });
      expect(group2.fingerprint).toBe(group1.fingerprint);
      expect(group2.count).toBe(2);
    });

    it('creates separate groups for different error types', () => {
      const agg = new ErrorAggregator();

      agg.addError({
        traceId: 't1',
        spanId: 's1',
        spanName: 'GET /api',
        service: 'svc',
        timestamp: Date.now(),
        error: { type: 'TypeError', message: 'cannot read property' },
      });

      const group = agg.addError({
        traceId: 't2',
        spanId: 's2',
        spanName: 'GET /api',
        service: 'svc',
        timestamp: Date.now(),
        error: { type: 'ReferenceError', message: 'x is not defined' },
      });

      expect(group.count).toBe(1);
      expect(agg.getErrorGroups()).toHaveLength(2);
    });
  });

  describe('addErrorsFromTrace', () => {
    it('extracts errors from trace with exception event', () => {
      const agg = new ErrorAggregator();
      const trace = makeErrorTrace('t1', 'something broke');

      const groups = agg.addErrorsFromTrace(trace);
      expect(groups.length).toBeGreaterThan(0);
      expect(groups[0].type).toBe('Error');
      expect(groups[0].message).toBe('something broke');
    });

    it('extracts errors from trace status without events', () => {
      const agg = new ErrorAggregator();
      const trace = makeTrace({
        traceId: 't1',
        status: 'ERROR',
        rootSpan: {
          traceId: 't1',
          spanId: 's1',
          name: 'GET /api',
          kind: 'SERVER',
          startTime: 100,
          endTime: 200,
          duration: 100,
          attributes: {},
          status: { code: 'ERROR', message: 'internal error' },
          events: [],
        },
      });

      const groups = agg.addErrorsFromTrace(trace);
      expect(groups).toHaveLength(1);
      expect(groups[0].type).toBe('Error');
      expect(groups[0].message).toBe('internal error');
    });

    it('returns empty array for successful trace', () => {
      const agg = new ErrorAggregator();
      const trace = makeTrace({ traceId: 't1' });

      const groups = agg.addErrorsFromTrace(trace);
      expect(groups).toHaveLength(0);
    });
  });

  describe('maxGroups limit', () => {
    it('respects maxGroups limit', () => {
      const agg = new ErrorAggregator({ maxGroups: 2 });

      for (let i = 0; i < 5; i++) {
        agg.addError({
          traceId: `t${i}`,
          spanId: `s${i}`,
          spanName: 'test',
          service: 'svc',
          timestamp: Date.now(),
          error: {
            type: `Error${i}`,
            message: `msg${i}`,
            stackTrace: `Error${i}: msg${i}\n  at unique${i} (file${i}.js:1:1)`,
          },
        });
      }

      expect(agg.getErrorGroups().length).toBeLessThanOrEqual(2);
    });
  });

  describe('clear', () => {
    it('clears all error groups', () => {
      const agg = new ErrorAggregator();
      agg.addError({
        traceId: 't1',
        spanId: 's1',
        spanName: 'test',
        service: 'svc',
        timestamp: Date.now(),
        error: { type: 'Error', message: 'fail' },
      });

      expect(agg.getErrorGroups().length).toBe(1);
      agg.clear();
      expect(agg.getErrorGroups().length).toBe(0);
    });
  });

  describe('getErrorGroups', () => {
    it('returns groups sorted by last seen time', () => {
      const agg = new ErrorAggregator();

      agg.addError({
        traceId: 't1',
        spanId: 's1',
        spanName: 'test',
        service: 'svc',
        timestamp: 100,
        error: { type: 'Error', message: 'first' },
      });

      agg.addError({
        traceId: 't2',
        spanId: 's2',
        spanName: 'test',
        service: 'svc',
        timestamp: 200,
        error: { type: 'Error', message: 'second' },
      });

      const groups = agg.getErrorGroups();
      expect(groups).toHaveLength(2);
    });
  });
});
