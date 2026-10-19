import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import type {
  PushMetricExporter,
  ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import type { LogRecordProcessor, SdkLogRecord } from '@opentelemetry/sdk-logs';
import {
  clearPolicies,
  getPolicies,
  MAX_MATCH_LENGTH,
  applyMetricPolicies,
  PolicyLogRecordProcessor,
  PolicyMetricExporter,
  policySpanFilter,
  setPolicies,
  unsupportedReason,
  type Policy,
} from './policy';
import { logRecordDouble, readableSpanDouble } from './testing/doubles';

function makeSpan(overrides: Partial<ReadableSpan> = {}): ReadableSpan {
  return readableSpanDouble({
    name: 'GET /health',
    kind: SpanKind.SERVER,
    attributes: {},
    status: { code: SpanStatusCode.UNSET },
    resource: { attributes: { 'service.name': 'api' } },
    instrumentationScope: { name: 'test' },
    spanContext: () => ({
      traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      spanId: 'bbbbbbbbbbbbbbbb',
      traceFlags: 1,
    }),
    ...overrides,
  });
}

function makeLog(overrides: Partial<SdkLogRecord> = {}): SdkLogRecord {
  return logRecordDouble({
    body: 'hello',
    severityText: 'INFO',
    attributes: {},
    resource: { attributes: {} },
    instrumentationScope: { name: 'test' },
    ...overrides,
  });
}

function collectingProcessor() {
  const emitted: SdkLogRecord[] = [];
  const wrapped: LogRecordProcessor = {
    onEmit: (record) => {
      emitted.push(record);
    },
    shutdown: () => Promise.resolve(),
    forceFlush: () => Promise.resolve(),
  };
  return { emitted, processor: new PolicyLogRecordProcessor(wrapped) };
}

beforeEach(() => {
  clearPolicies();
  vi.restoreAllMocks();
});

describe('policy validation', () => {
  it('accepts a minimal valid policy', () => {
    expect(
      unsupportedReason({
        id: 'p',
        log: { match: [{ log_field: 'severity_text', exact: 'DEBUG' }] },
      }),
    ).toBeUndefined();
  });

  it.each<[string, Policy, string]>([
    ['no id', { id: '' } as Policy, 'id'],
    [
      'two targets',
      {
        id: 'p',
        trace: { match: [{ trace_field: 'name', exists: true }] },
        log: { match: [{ log_field: 'body', exists: true }] },
      },
      'exactly one target',
    ],
    ['no matchers', { id: 'p', log: { match: [] } }, 'at least one matcher'],
    [
      'two field selectors',
      {
        id: 'p',
        log: {
          match: [{ log_field: 'body', log_attribute: 'x', exists: true }],
        },
      },
      'exactly one field selector',
    ],
    [
      'two match operators',
      {
        id: 'p',
        log: { match: [{ log_field: 'body', exact: 'a', exists: true }] },
      },
      'exactly one match operator',
    ],
    [
      'metric keep that is not a boolean',
      {
        id: 'p',
        metric: { match: [{ metric_field: 'name', exact: 'x' }] },
      } as unknown as Policy,
      'metric keep must be true or false',
    ],
    [
      'consistent-probability sampling mode',
      {
        id: 'p',
        trace: {
          match: [{ trace_field: 'name', exists: true }],
          keep: { percentage: 5, mode: 'equalizing' },
        },
      },
      'percentage',
    ],
    [
      'out of range percentage',
      {
        id: 'p',
        trace: {
          match: [{ trace_field: 'name', exists: true }],
          keep: { percentage: 150 },
        },
      },
      'between 0 and 100',
    ],
  ])('rejects %s', (_label, policy, expected) => {
    expect(unsupportedReason(policy)).toContain(expected);
  });

  it('skips unsupported and disabled policies but keeps the rest', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    setPolicies([
      { id: 'ok', log: { match: [{ log_field: 'body', exists: true }] } },
      {
        id: 'off',
        enabled: false,
        log: { match: [{ log_field: 'body', exists: true }] },
      },
      { id: 'bad', metric: { match: [], keep: false } },
    ]);
    expect(getPolicies().map((policy) => policy.id)).toEqual(['ok']);
  });
});

describe('trace policies', () => {
  it('drops spans matching a keep percentage of 0', () => {
    setPolicies([
      {
        id: 'drop-health',
        trace: {
          match: [{ trace_field: 'name', contains: '/health' }],
          keep: { percentage: 0 },
        },
      },
    ]);
    expect(policySpanFilter(makeSpan())).toBe(false);
    expect(policySpanFilter(makeSpan({ name: 'GET /users' }))).toBe(true);
  });

  it('ANDs matchers and honours negate', () => {
    setPolicies([
      {
        id: 'drop-db-clients',
        trace: {
          match: [
            { span_attribute: ['db', 'system'], exists: true },
            { trace_field: 'name', contains: 'health', negate: true },
          ],
          keep: { percentage: 0 },
        },
      },
    ]);
    const dbSpan = makeSpan({
      name: 'SELECT users',
      attributes: { 'db.system': 'postgresql' },
    });
    expect(policySpanFilter(dbSpan)).toBe(false);
    // second matcher fails -> policy does not apply
    expect(
      policySpanFilter(
        makeSpan({ name: 'health', attributes: { 'db.system': 'postgresql' } }),
      ),
    ).toBe(true);
    // first matcher fails -> policy does not apply
    expect(policySpanFilter(makeSpan({ name: 'SELECT users' }))).toBe(true);
  });

  it('applies the most restrictive keep across overlapping policies', () => {
    setPolicies([
      {
        id: 'keep-all',
        trace: {
          match: [{ trace_field: 'name', exists: true }],
          keep: { percentage: 100 },
        },
      },
      {
        id: 'drop',
        trace: {
          match: [{ trace_field: 'name', exists: true }],
          keep: { percentage: 0 },
        },
      },
    ]);
    expect(policySpanFilter(makeSpan())).toBe(false);
  });

  it('samples deterministically per trace id', () => {
    setPolicies([
      {
        id: 'sample-half',
        trace: {
          match: [{ trace_field: 'name', exists: true }],
          keep: { percentage: 50 },
        },
      },
    ]);
    const first = policySpanFilter(makeSpan());
    expect(policySpanFilter(makeSpan({ name: 'other' }))).toBe(first);
  });

  it('matches resource and scope attributes', () => {
    setPolicies([
      {
        id: 'drop-by-service',
        trace: {
          match: [{ resource_attribute: 'service.name', exact: 'api' }],
          keep: { percentage: 0 },
        },
      },
    ]);
    expect(policySpanFilter(makeSpan())).toBe(false);
  });

  it('is fail-open when a matcher throws', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    setPolicies([
      {
        id: 'boom',
        trace: {
          match: [{ trace_field: 'name', exact: 'x' }],
          keep: { percentage: 0 },
        },
      },
    ]);
    const exploding = makeSpan({
      spanContext: () => {
        throw new Error('boom');
      },
    } as Partial<ReadableSpan>);
    expect(policySpanFilter(exploding)).toBe(true);
  });

  it('does not regex-match values beyond the length cap', () => {
    setPolicies([
      {
        id: 'long',
        trace: {
          match: [{ trace_field: 'name', regex: 'a+' }],
          keep: { percentage: 0 },
        },
      },
    ]);
    expect(policySpanFilter(makeSpan({ name: 'aaa' }))).toBe(false);
    expect(
      policySpanFilter(makeSpan({ name: 'a'.repeat(MAX_MATCH_LENGTH + 1) })),
    ).toBe(true);
  });
});

describe('log policies', () => {
  it('drops logs with keep: none', () => {
    setPolicies([
      {
        id: 'drop-debug-logs',
        log: {
          match: [{ log_field: 'severity_text', regex: '^(DEBUG|TRACE)$' }],
          keep: 'none',
        },
      },
    ]);
    const { emitted, processor } = collectingProcessor();
    processor.onEmit(makeLog({ severityText: 'DEBUG' }));
    processor.onEmit(makeLog({ severityText: 'INFO' }));
    expect(emitted.map((record) => record.severityText)).toEqual(['INFO']);
  });

  it('redacts a matched attribute', () => {
    setPolicies([
      {
        id: 'redact-ccs',
        log: {
          match: [{ log_attribute: ['ccn'], exists: true }],
          transform: { redact: [{ log_attribute: ['ccn'] }] },
        },
      },
    ]);
    const { emitted, processor } = collectingProcessor();
    processor.onEmit(makeLog({ attributes: { ccn: '4111111111111111' } }));
    expect(emitted[0]?.attributes).toEqual({ ccn: '[REDACTED]' });
  });

  it('applies transforms in spec order: remove, redact, rename, add', () => {
    setPolicies([
      {
        id: 'transform',
        log: {
          match: [{ log_field: 'body', exists: true }],
          transform: {
            remove: [{ log_attribute: 'gone' }],
            redact: [{ log_attribute: 'secret', replacement: '***' }],
            rename: [{ log_attribute: 'old', to: 'new' }],
            add: [{ log_attribute: 'env', value: 'prod' }],
          },
        },
      },
    ]);
    const { emitted, processor } = collectingProcessor();
    processor.onEmit(
      makeLog({ attributes: { gone: 'x', secret: 's', old: 'v' } }),
    );
    expect(emitted[0]?.attributes).toEqual({
      secret: '***',
      new: 'v',
      env: 'prod',
    });
  });

  it('does not overwrite on add without upsert', () => {
    setPolicies([
      {
        id: 'add',
        log: {
          match: [{ log_field: 'body', exists: true }],
          transform: { add: [{ log_attribute: 'env', value: 'prod' }] },
        },
      },
    ]);
    const { emitted, processor } = collectingProcessor();
    processor.onEmit(makeLog({ attributes: { env: 'dev' } }));
    expect(emitted[0]?.attributes).toEqual({ env: 'dev' });
  });

  it('matches case-insensitively when asked', () => {
    setPolicies([
      {
        id: 'ci',
        log: {
          match: [
            {
              log_field: 'severity_text',
              exact: 'debug',
              case_insensitive: true,
            },
          ],
          keep: 'none',
        },
      },
    ]);
    const { emitted, processor } = collectingProcessor();
    processor.onEmit(makeLog({ severityText: 'DEBUG' }));
    expect(emitted).toHaveLength(0);
  });

  it('emits unchanged when no policy matches', () => {
    setPolicies([
      {
        id: 'other',
        log: { match: [{ log_attribute: 'nope', exists: true }], keep: 'none' },
      },
    ]);
    const { emitted, processor } = collectingProcessor();
    processor.onEmit(makeLog());
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.body).toBe('hello');
  });

  it('is fail-open when a transform throws', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    setPolicies([
      {
        id: 'boom',
        log: {
          match: [{ log_field: 'body', exists: true }],
          transform: { remove: [{ log_attribute: 'x' }] },
        },
      },
    ]);
    const { emitted, processor } = collectingProcessor();
    const frozen = makeLog();
    Object.defineProperty(frozen, 'attributes', {
      get() {
        throw new Error('boom');
      },
    });
    processor.onEmit(frozen);
    expect(emitted).toHaveLength(1);
  });
});

describe('metric policies', () => {
  // DataPointType.SUM is 3; a literal keeps the SDK enum out of the test.
  const batch = (): ResourceMetrics =>
    ({
      resource: { attributes: { 'service.name': 'api' } },
      scopeMetrics: [
        {
          scope: { name: 'app' },
          metrics: [
            {
              descriptor: {
                name: 'http.server.requests',
                description: '',
                unit: '1',
              },
              dataPointType: 3,
              dataPoints: [
                { attributes: { 'http.route': '/health' }, value: 5 },
                { attributes: { 'http.route': '/orders' }, value: 2 },
              ],
            },
            {
              descriptor: {
                name: 'debug.cache.size',
                description: '',
                unit: 'By',
              },
              dataPointType: 3,
              dataPoints: [{ attributes: {}, value: 1 }],
            },
          ],
        },
      ],
    }) as unknown as ResourceMetrics;

  const names = (metrics: ResourceMetrics) =>
    metrics.scopeMetrics.flatMap((scope) =>
      scope.metrics.map((metric) => [
        metric.descriptor.name,
        metric.dataPoints.length,
      ]),
    );

  it('drops whole metrics by name and single data points by attribute', () => {
    setPolicies([
      {
        id: 'drop-debug-metrics',
        metric: {
          match: [{ metric_field: 'name', starts_with: 'debug.' }],
          keep: false,
        },
      },
      {
        id: 'drop-health-points',
        metric: {
          match: [{ datapoint_attribute: 'http.route', exact: '/health' }],
          keep: false,
        },
      },
    ]);
    expect(names(applyMetricPolicies(batch()))).toEqual([
      ['http.server.requests', 1],
    ]);
  });

  it('matches on metric type and keeps everything when nothing matches', () => {
    setPolicies([
      {
        id: 'drop-gauges',
        metric: {
          match: [{ metric_type: 'gauge', exact: 'gauge' }],
          keep: false,
        },
      },
    ]);
    expect(names(applyMetricPolicies(batch()))).toEqual([
      ['http.server.requests', 2],
      ['debug.cache.size', 1],
    ]);
  });

  it('exports through the wrapped exporter with policies applied', () => {
    setPolicies([
      {
        id: 'drop-all-sums',
        metric: { match: [{ metric_type: 'sum', exact: 'sum' }], keep: false },
      },
    ]);
    const exported: ResourceMetrics[] = [];
    const inner = {
      export: (metrics: ResourceMetrics) => exported.push(metrics),
      forceFlush: async () => {},
      shutdown: async () => {},
    } as unknown as PushMetricExporter;
    new PolicyMetricExporter(inner).export(batch(), () => {});
    expect(exported[0]?.scopeMetrics).toEqual([]);
  });
});
