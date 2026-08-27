import type { Meta, StoryObj } from '@storybook/svelte-vite';
import MetricsView from './MetricsView.svelte';

// Catalogue only — no assertions. Behavioural claims belong in the paired
// `*.test.ts`; this file exists so every state is browsable in Storybook.
//
// MetricsView loads from the devtools server rather than from the widget store,
// so these stories stub `fetch`. That keeps the story exercising the same code
// path a live server would drive, rather than a second rendering path that
// could drift from it.

const T0 = Date.now() - 10 * 60_000;

function points(values: number[]) {
  return values.map((value, i) => ({
    timestamp: T0 + i * 30_000,
    attributes: {},
    value,
  }));
}

/**
 * Answer both metrics endpoints for one story, then put `fetch` back.
 *
 * Restoring matters: a decorator that replaces `globalThis.fetch` and walks
 * away leaks the stub into every story rendered afterwards — including the
 * harness's own requests. Storybook's `beforeEach` takes a teardown for exactly
 * this, so the stub lives and dies with the story.
 */
function withServer(
  metrics: unknown[],
  seriesByName: Record<string, unknown[]>,
) {
  return () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const href = String(url);
      if (href.endsWith('/api/metrics')) {
        return new Response(JSON.stringify({ metrics }), { status: 200 });
      }
      if (href.endsWith('/api/query/metrics')) {
        const body = JSON.parse((init?.body as string) ?? '{}');
        return new Response(
          JSON.stringify({ series: seriesByName[body.name] ?? [] }),
          { status: 200 },
        );
      }
      // Anything else is the harness's own traffic — leave it alone.
      return original(url, init);
    }) as typeof fetch;

    return () => {
      globalThis.fetch = original;
    };
  };
}

const meta = {
  title: 'Views/MetricsView',
  component: MetricsView,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof MetricsView>;

export default meta;
type Story = StoryObj<typeof meta>;

const counterSeries = [
  {
    seriesId: 's-get',
    name: 'http.requests',
    unit: '1',
    kind: 'sum',
    temporality: 'delta',
    service: 'api',
    attributes: { 'http.method': 'GET' },
    points: points([4, 9, 6, 14, 11, 18, 12, 20]),
  },
  {
    seriesId: 's-post',
    name: 'http.requests',
    unit: '1',
    kind: 'sum',
    temporality: 'delta',
    service: 'api',
    attributes: { 'http.method': 'POST' },
    points: points([1, 2, 2, 5, 3, 6, 4, 7]),
  },
];

export const Counter: Story = {
  beforeEach: withServer(
    [{ name: 'http.requests', kind: 'sum', unit: '1', seriesCount: 2 }],
    { 'http.requests': counterSeries },
  ),
};

/** A histogram renders as a bucket distribution, not a line. */
export const Histogram: Story = {
  beforeEach: withServer(
    [
      {
        name: 'http.server.duration',
        kind: 'histogram',
        unit: 'ms',
        seriesCount: 1,
        description: 'Inbound request duration',
      },
    ],
    {
      'http.server.duration': [
        {
          seriesId: 's-hist',
          name: 'http.server.duration',
          unit: 'ms',
          kind: 'histogram',
          service: 'api',
          attributes: {},
          points: [
            {
              timestamp: T0,
              attributes: {},
              count: 120,
              sum: 8400,
              bucketCounts: [40, 55, 20, 5],
              explicitBounds: [10, 100, 1000],
            },
          ],
        },
      ],
    },
  ),
};

/** Exponential buckets retain their native resolution and negative values. */
export const ExponentialHistogram: Story = {
  beforeEach: withServer(
    [
      {
        name: 'rpc.duration',
        kind: 'exponentialHistogram',
        unit: 'ms',
        seriesCount: 1,
      },
    ],
    {
      'rpc.duration': [
        {
          seriesId: 's-exp-hist',
          name: 'rpc.duration',
          unit: 'ms',
          kind: 'exponentialHistogram',
          service: 'api',
          resource: { 'service.name': 'api', 'host.name': 'dev-machine' },
          attributes: {},
          points: [
            {
              timestamp: T0,
              attributes: {},
              count: 120,
              scale: 2,
              zeroCount: 3,
              zeroThreshold: 0.001,
              positive: { offset: 8, bucketCounts: [15, 42, 37, 18] },
              negative: { offset: -2, bucketCounts: [2, 3] },
            },
          ],
        },
      ],
    },
  ),
};

/** Exemplars appear as dots that open the trace behind a spike. */
export const WithExemplars: Story = {
  beforeEach: withServer(
    [{ name: 'http.requests', kind: 'sum', seriesCount: 1 }],
    {
      'http.requests': [
        {
          ...counterSeries[0],
          points: points([4, 9, 6, 40, 11, 18]).map((p, i) =>
            i === 3
              ? {
                  ...p,
                  exemplars: [
                    {
                      value: 40,
                      timestamp: p.timestamp,
                      traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1',
                    },
                  ],
                }
              : p,
          ),
        },
      ],
    },
  ),
};

/** Nothing ingested yet — distinct from an unreachable server. */
export const Empty: Story = {
  beforeEach: withServer([], {}),
};
