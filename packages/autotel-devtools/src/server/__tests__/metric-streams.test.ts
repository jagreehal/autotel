/**
 * Rich metric parsing contract.
 *
 * The Agents tab's `parseOtlpMetrics` flattens a histogram to its `count`,
 * which is all a counter-shaped session model needs. Charts need the rest — the
 * buckets, the sum, min/max, quantiles and exemplars — so this parser keeps the
 * whole data point and `parseOtlpMetrics` becomes a projection of it.
 *
 * Exemplars matter most here: they are what turns a spike on a chart into the
 * trace that caused it, and they are trivially lost in a parser that only reads
 * the fields the current UI happens to render.
 */

import { describe, it, expect } from 'vitest';
import { parseOtlpMetricStreams } from '../metric-streams';

/** Wrap metrics in the OTLP envelope an SDK sends. */
function envelope(metrics: unknown[], service = 'api') {
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: service } },
          ],
        },
        scopeMetrics: [
          { scope: { name: 'test-scope', version: '1.0' }, metrics },
        ],
      },
    ],
  };
}

const T0 = 1_700_000_000_000;
const nano = (ms: number) => String(BigInt(ms) * 1_000_000n);

describe('gauges and sums', () => {
  it('parses a gauge point', () => {
    const [stream] = parseOtlpMetricStreams(
      envelope([
        {
          name: 'process.memory',
          unit: 'By',
          gauge: {
            dataPoints: [{ asDouble: 1024, timeUnixNano: nano(T0) }],
          },
        },
      ]),
    );

    expect(stream.name).toBe('process.memory');
    expect(stream.kind).toBe('gauge');
    expect(stream.unit).toBe('By');
    expect(stream.points[0]).toMatchObject({ value: 1024, timestamp: T0 });
  });

  it('parses an integer sum and its temporality', () => {
    const [stream] = parseOtlpMetricStreams(
      envelope([
        {
          name: 'http.requests',
          sum: {
            aggregationTemporality: 2,
            isMonotonic: true,
            dataPoints: [{ asInt: '42', timeUnixNano: nano(T0) }],
          },
        },
      ]),
    );

    expect(stream.kind).toBe('sum');
    expect(stream.temporality).toBe('cumulative');
    expect(stream.monotonic).toBe(true);
    expect(stream.points[0].value).toBe(42);
  });

  it('keeps point attributes, which is what separates one series from another', () => {
    const [stream] = parseOtlpMetricStreams(
      envelope([
        {
          name: 'http.requests',
          sum: {
            dataPoints: [
              {
                asInt: 1,
                timeUnixNano: nano(T0),
                attributes: [
                  { key: 'http.method', value: { stringValue: 'GET' } },
                  { key: 'http.status_code', value: { intValue: 200 } },
                ],
              },
            ],
          },
        },
      ]),
    );

    expect(stream.points[0].attributes).toEqual({
      'http.method': 'GET',
      'http.status_code': 200,
    });
  });

  it('carries the resource service name onto the stream', () => {
    const [stream] = parseOtlpMetricStreams(
      envelope(
        [{ name: 'm', gauge: { dataPoints: [{ asDouble: 1 }] } }],
        'worker',
      ),
    );
    expect(stream.service).toBe('worker');
  });

  it('keeps the instrumentation scope', () => {
    const [stream] = parseOtlpMetricStreams(
      envelope([{ name: 'm', gauge: { dataPoints: [{ asDouble: 1 }] } }]),
    );
    expect(stream.scope).toEqual({ name: 'test-scope', version: '1.0' });
  });
});

describe('histograms', () => {
  const histogram = {
    name: 'http.server.duration',
    unit: 'ms',
    histogram: {
      aggregationTemporality: 1,
      dataPoints: [
        {
          count: '7',
          sum: 1234.5,
          min: 3,
          max: 900,
          bucketCounts: ['1', '4', '2'],
          explicitBounds: [10, 100],
          timeUnixNano: nano(T0),
        },
      ],
    },
  };

  it('keeps buckets and bounds rather than collapsing to a count', () => {
    const [stream] = parseOtlpMetricStreams(envelope([histogram]));
    expect(stream.kind).toBe('histogram');
    expect(stream.points[0].bucketCounts).toEqual([1, 4, 2]);
    expect(stream.points[0].explicitBounds).toEqual([10, 100]);
  });

  it('keeps count, sum, min and max', () => {
    const [stream] = parseOtlpMetricStreams(envelope([histogram]));
    expect(stream.points[0]).toMatchObject({
      count: 7,
      sum: 1234.5,
      min: 3,
      max: 900,
    });
  });

  it('reads delta temporality', () => {
    const [stream] = parseOtlpMetricStreams(envelope([histogram]));
    expect(stream.temporality).toBe('delta');
  });

  it('has one more bucket than bound, the +Inf overflow', () => {
    const [stream] = parseOtlpMetricStreams(envelope([histogram]));
    const point = stream.points[0];
    expect(point.bucketCounts!.length).toBe(point.explicitBounds!.length + 1);
  });
});

describe('exponential histograms', () => {
  it('keeps scale, zero values, and positive and negative buckets', () => {
    const [stream] = parseOtlpMetricStreams(
      envelope([
        {
          name: 'rpc.duration',
          exponentialHistogram: {
            aggregationTemporality: 2,
            dataPoints: [
              {
                count: '9',
                sum: 12.5,
                scale: 3,
                zeroCount: '2',
                zeroThreshold: 0.001,
                positive: { offset: -1, bucketCounts: ['1', '4'] },
                negative: { offset: 2, bucketCounts: ['2'] },
                timeUnixNano: nano(T0),
              },
            ],
          },
        },
      ]),
    );

    expect(stream.kind).toBe('exponentialHistogram');
    expect(stream.points[0]).toMatchObject({
      scale: 3,
      zeroCount: 2,
      zeroThreshold: 0.001,
      positive: { offset: -1, bucketCounts: [1, 4] },
      negative: { offset: 2, bucketCounts: [2] },
    });
  });
});

describe('exemplars', () => {
  it('keeps the trace and span an exemplar points at', () => {
    // This is what turns a spike on a chart into the trace that caused it.
    const [stream] = parseOtlpMetricStreams(
      envelope([
        {
          name: 'http.server.duration',
          histogram: {
            dataPoints: [
              {
                count: 1,
                timeUnixNano: nano(T0),
                exemplars: [
                  {
                    asDouble: 903.2,
                    timeUnixNano: nano(T0 - 5),
                    traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1',
                    spanId: '1111111111111111',
                  },
                ],
              },
            ],
          },
        },
      ]),
    );

    expect(stream.points[0].exemplars).toEqual([
      {
        value: 903.2,
        timestamp: T0 - 5,
        traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1',
        spanId: '1111111111111111',
      },
    ]);
  });

  it('omits exemplars entirely when there are none', () => {
    const [stream] = parseOtlpMetricStreams(
      envelope([{ name: 'm', gauge: { dataPoints: [{ asDouble: 1 }] } }]),
    );
    expect(stream.points[0].exemplars).toBeUndefined();
  });
});

describe('summary', () => {
  it('keeps precomputed quantiles', () => {
    const [stream] = parseOtlpMetricStreams(
      envelope([
        {
          name: 'rpc.duration',
          summary: {
            dataPoints: [
              {
                count: 100,
                sum: 5000,
                timeUnixNano: nano(T0),
                quantileValues: [
                  { quantile: 0.5, value: 40 },
                  { quantile: 0.99, value: 320 },
                ],
              },
            ],
          },
        },
      ]),
    );

    expect(stream.kind).toBe('summary');
    expect(stream.points[0].quantiles).toEqual([
      { quantile: 0.5, value: 40 },
      { quantile: 0.99, value: 320 },
    ]);
  });
});

describe('robustness', () => {
  it('returns nothing for a payload that is not OTLP metrics', () => {
    expect(parseOtlpMetricStreams({ nope: true })).toEqual([]);
    expect(parseOtlpMetricStreams(null)).toEqual([]);
    expect(parseOtlpMetricStreams('nonsense')).toEqual([]);
  });

  it('skips a metric with no recognised aggregation rather than throwing', () => {
    const streams = parseOtlpMetricStreams(
      envelope([
        { name: 'mystery' },
        { name: 'ok', gauge: { dataPoints: [{ asDouble: 1 }] } },
      ]),
    );
    expect(streams.map((s) => s.name)).toEqual(['ok']);
  });

  it('tolerates a metric with an empty data point array', () => {
    expect(
      parseOtlpMetricStreams(
        envelope([{ name: 'm', gauge: { dataPoints: [] } }]),
      ),
    ).toEqual([]);
  });

  it('falls back to the start timestamp when the point has no end timestamp', () => {
    const [stream] = parseOtlpMetricStreams(
      envelope([
        {
          name: 'm',
          gauge: { dataPoints: [{ asDouble: 1, startTimeUnixNano: nano(T0) }] },
        },
      ]),
    );
    expect(stream.points[0].timestamp).toBe(T0);
  });

  it('separates metrics of the same name from different scopes', () => {
    const payload = {
      resourceMetrics: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'api' } },
            ],
          },
          scopeMetrics: [
            {
              scope: { name: 'a' },
              metrics: [
                { name: 'm', gauge: { dataPoints: [{ asDouble: 1 }] } },
              ],
            },
            {
              scope: { name: 'b' },
              metrics: [
                { name: 'm', gauge: { dataPoints: [{ asDouble: 2 }] } },
              ],
            },
          ],
        },
      ],
    };

    const streams = parseOtlpMetricStreams(payload);
    expect(streams).toHaveLength(2);
    expect(streams.map((s) => s.scope?.name)).toEqual(['a', 'b']);
  });
});
