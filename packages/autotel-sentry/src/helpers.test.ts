import { describe, it, expect } from 'vitest';
import {
  convertOtelTimeToSeconds,
  mapOtelStatus,
  parseSpanDescription,
  getTraceData,
  isSentryRequestSpan,
  getOtelContextFromSpan,
} from './helpers';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';

function createMockReadableSpan(overrides: Partial<{
  attributes: Record<string, unknown>;
  status: { code: number };
  kind: number;
  name: string;
  spanContext: () => { traceId: string; spanId: string };
  parentSpanContext: { spanId: string } | undefined;
  resource: { attributes: Record<string, unknown> };
}> = {}): ReadableSpan {
  return {
    name: overrides.name ?? 'test',
    kind: overrides.kind ?? 0,
    spanContext: overrides.spanContext ?? (() => ({ traceId: 't1', spanId: 's1' })),
    parentSpanContext: overrides.parentSpanContext,
    startTime: [0, 0],
    endTime: [1, 0],
    status: overrides.status ?? { code: 1 },
    attributes: overrides.attributes ?? {},
    resource: overrides.resource ?? { attributes: { 'service.name': 'svc' } },
    events: [],
    links: [],
    duration: [1, 0],
    ended: true,
    instrumentationScope: { name: 'test', version: '1.0' },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as ReadableSpan;
}

describe('helpers', () => {
  describe('convertOtelTimeToSeconds', () => {
    it('converts tuple HrTime to seconds', () => {
      expect(convertOtelTimeToSeconds([1, 500000000])).toBe(1.5);
    });
    it('converts number (nanoseconds) to seconds', () => {
      expect(convertOtelTimeToSeconds(2e9)).toBe(2);
    });
  });

  describe('mapOtelStatus', () => {
    it('returns ok for status code 0 or 1', () => {
      expect(mapOtelStatus(createMockReadableSpan({ status: { code: 0 } }))).toBe('ok');
      expect(mapOtelStatus(createMockReadableSpan({ status: { code: 1 } }))).toBe('ok');
    });
    it('returns internal_error for HTTP 500', () => {
      const span = createMockReadableSpan({
        status: { code: 2 },
        attributes: { 'http.status_code': '500' },
      });
      expect(mapOtelStatus(span)).toBe('internal_error');
    });
    it('returns not_found for HTTP 404', () => {
      const span = createMockReadableSpan({
        status: { code: 2 },
        attributes: { 'http.status_code': '404' },
      });
      expect(mapOtelStatus(span)).toBe('not_found');
    });
    it('returns unknown_error when status is error and no http/grpc code', () => {
      const span = createMockReadableSpan({ status: { code: 2 } });
      expect(mapOtelStatus(span)).toBe('unknown_error');
    });
  });

  describe('parseSpanDescription', () => {
    it('returns name as description and default op', () => {
      const span = createMockReadableSpan({ name: 'my-span' });
      const { op, description } = parseSpanDescription(span);
      expect(description).toBe('my-span');
      expect(op).toBe('default');
    });
    it('returns http.client op for http attributes', () => {
      const span = createMockReadableSpan({
        name: 'GET',
        attributes: { 'http.method': 'GET' },
      });
      const { op } = parseSpanDescription(span);
      expect(op).toBe('http.client');
    });
    it('returns db.query op for db attributes', () => {
      const span = createMockReadableSpan({
        name: 'query',
        attributes: { 'db.system': 'postgresql' },
      });
      const { op } = parseSpanDescription(span);
      expect(op).toBe('db.query');
    });
  });

  describe('getTraceData', () => {
    it('returns traceId, spanId, parentSpanId from span', () => {
      const span = createMockReadableSpan({
        spanContext: () => ({ traceId: 't1', spanId: 's1' }),
        parentSpanContext: { spanId: 'p1', traceId: 't1', traceFlags: 0 },
      });
      const data = getTraceData(span);
      expect(data).toEqual({ traceId: 't1', spanId: 's1', parentSpanId: 'p1' });
    });
  });

  describe('isSentryRequestSpan', () => {
    it('returns true when http.url contains DSN host', () => {
      const span = createMockReadableSpan({
        attributes: { 'http.url': 'https://o123.ingest.sentry.io/api/456/envelope/' },
      });
      expect(isSentryRequestSpan(span, () => 'ingest.sentry.io')).toBe(true);
    });
    it('returns false when http.url is missing', () => {
      const span = createMockReadableSpan({ attributes: {} });
      expect(isSentryRequestSpan(span, () => 'sentry.io')).toBe(false);
    });
    it('returns false when getDsnHost returns undefined', () => {
      const span = createMockReadableSpan({
        attributes: { 'http.url': 'https://sentry.io/api/' },
      });
      expect(isSentryRequestSpan(span, () => undefined)).toBe(false);
    });
  });

  describe('getOtelContextFromSpan', () => {
    it('returns attributes and resource from span', () => {
      const span = createMockReadableSpan({
        attributes: { 'http.method': 'GET' },
        resource: { attributes: { 'service.name': 'my-svc' } },
      });
      const { attributes, resource } = getOtelContextFromSpan(span);
      expect(attributes).toEqual({ 'http.method': 'GET' });
      expect(resource).toEqual({ 'service.name': 'my-svc' });
    });
  });
});
