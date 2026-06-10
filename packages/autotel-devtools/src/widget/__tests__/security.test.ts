import { describe, it, expect } from 'vitest';
import {
  collectSecuritySpans,
  countBySeverity,
  extractSecurityInfo,
  isSecuritySpan,
  severityAtLeast,
} from '../utils/security';
import type { SpanData, TraceData } from '../types';

function makeSpan(overrides: Partial<SpanData> = {}): SpanData {
  return {
    traceId: 't1',
    spanId: 's1',
    name: 'POST /login',
    kind: 'SERVER',
    startTime: 1000,
    endTime: 1100,
    duration: 100,
    attributes: {},
    status: { code: 'OK' },
    ...overrides,
  };
}

function makeTrace(spans: SpanData[], service = 'api'): TraceData {
  const root = spans[0] as SpanData;
  return {
    traceId: root.traceId,
    correlationId: 'c1',
    rootSpan: root,
    spans,
    startTime: root.startTime,
    endTime: root.endTime,
    duration: root.duration,
    status: 'OK',
    affectedSpans: [],
    service,
  };
}

describe('isSecuritySpan', () => {
  it('detects security.event spans', () => {
    expect(
      isSecuritySpan(
        makeSpan({ attributes: { 'security.event': 'auth.login.failed' } }),
      ),
    ).toBe(true);
  });

  it('detects suspicious-request spans', () => {
    expect(
      isSecuritySpan(
        makeSpan({ attributes: { 'security.suspicious_request': true } }),
      ),
    ).toBe(true);
  });

  it('ignores ordinary spans', () => {
    expect(
      isSecuritySpan(makeSpan({ attributes: { 'http.route': '/orders' } })),
    ).toBe(false);
  });
});

describe('extractSecurityInfo', () => {
  it('extracts the full security.* schema', () => {
    const info = extractSecurityInfo(
      makeSpan({
        attributes: {
          'security.event': 'access.denied',
          'security.category': 'authorization',
          'security.outcome': 'denied',
          'security.severity': 'critical',
          'security.reason': 'missing_role',
        },
      }),
      'api',
    );

    expect(info).toMatchObject({
      event: 'access.denied',
      category: 'authorization',
      outcome: 'denied',
      severity: 'critical',
      reason: 'missing_role',
      service: 'api',
      suspicious: false,
    });
  });

  it('treats processor-flagged probes without severity as warning', () => {
    const info = extractSecurityInfo(
      makeSpan({
        attributes: {
          'security.suspicious_request': true,
          'security.signal': 'path_traversal',
        },
      }),
    );

    expect(info).toMatchObject({
      suspicious: true,
      signal: 'path_traversal',
      severity: 'warning',
    });
  });

  it('defaults unknown severity to info', () => {
    const info = extractSecurityInfo(
      makeSpan({
        attributes: {
          'security.event': 'config.changed',
          'security.severity': 'bogus',
        },
      }),
    );
    expect(info?.severity).toBe('info');
  });

  it('returns null for non-security spans', () => {
    expect(extractSecurityInfo(makeSpan())).toBeNull();
  });
});

describe('collectSecuritySpans', () => {
  it('collects across traces, newest first', () => {
    const traces = [
      makeTrace([
        makeSpan({
          traceId: 'old',
          startTime: 1000,
          attributes: { 'security.event': 'auth.login.failed' },
        }),
        makeSpan({ traceId: 'old', spanId: 's2', startTime: 1001 }),
      ]),
      makeTrace([
        makeSpan({
          traceId: 'new',
          startTime: 2000,
          attributes: { 'security.suspicious_request': true },
        }),
      ]),
    ];

    const infos = collectSecuritySpans(traces);
    expect(infos).toHaveLength(2);
    expect(infos[0]?.traceId).toBe('new');
    expect(infos[1]?.traceId).toBe('old');
  });
});

describe('severity helpers', () => {
  it('counts by severity', () => {
    const traces = [
      makeTrace([
        makeSpan({
          attributes: {
            'security.event': 'a',
            'security.severity': 'critical',
          },
        }),
        makeSpan({
          spanId: 's2',
          attributes: { 'security.event': 'b', 'security.severity': 'warning' },
        }),
        makeSpan({
          spanId: 's3',
          attributes: { 'security.event': 'c' },
        }),
      ]),
    ];

    expect(countBySeverity(collectSecuritySpans(traces))).toEqual({
      info: 1,
      warning: 1,
      error: 0,
      critical: 1,
    });
  });

  it('filters by minimum severity', () => {
    const info = extractSecurityInfo(
      makeSpan({
        attributes: { 'security.event': 'x', 'security.severity': 'error' },
      }),
    );
    expect(severityAtLeast(info!, 'warning')).toBe(true);
    expect(severityAtLeast(info!, 'critical')).toBe(false);
  });
});
