/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import HistogramChart from '../components/charts/HistogramChart.svelte';
import { histogramSeries } from '../components/charts/__fixtures__/metrics';

const point = histogramSeries[0].points[0];

describe('HistogramChart', () => {
  afterEach(cleanup);

  it('draws one bar per bucket', () => {
    render(HistogramChart, { props: { point } });
    // 4 bucket counts => 4 bars, each labelled with its range.
    expect(screen.getByText('≤10')).toBeTruthy();
    expect(screen.getByText('10–100')).toBeTruthy();
    // Bounds are locale-formatted, so 1000 reads as 1,000.
    expect(screen.getByText('100–1,000')).toBeTruthy();
    expect(screen.getByText('>1,000')).toBeTruthy();
  });

  it('shows the observation count for each bucket', () => {
    render(HistogramChart, { props: { point } });
    for (const count of ['40', '55', '20', '5']) {
      expect(screen.getByText(count)).toBeTruthy();
    }
  });

  it('reports p50, p90 and p99', () => {
    render(HistogramChart, { props: { point } });
    expect(screen.getByText('p50')).toBeTruthy();
    expect(screen.getByText('p90')).toBeTruthy();
    expect(screen.getByText('p99')).toBeTruthy();
  });

  it('appends the unit to the quantile readouts', () => {
    const { container } = render(HistogramChart, {
      props: { point, unit: 'ms' },
    });
    expect(container.textContent).toMatch(/\dms/);
  });

  it('says so when the point carries no buckets', () => {
    render(HistogramChart, {
      props: { point: { timestamp: 1, attributes: {}, value: 3 } },
    });
    expect(screen.getByText(/No bucket data/)).toBeTruthy();
  });

  it('handles a single +Inf bucket', () => {
    render(HistogramChart, {
      props: {
        point: {
          timestamp: 1,
          attributes: {},
          count: 12,
          bucketCounts: [12],
          explicitBounds: [],
        },
      },
    });
    expect(screen.getByText('all')).toBeTruthy();
  });

  it('labels the chart with its bucket and observation counts', () => {
    render(HistogramChart, { props: { point } });
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(
      /4 buckets, 120 observations/,
    );
  });

  it('shows each bucket share in its tooltip', () => {
    const { container } = render(HistogramChart, { props: { point } });
    const titles = [...container.querySelectorAll('[title]')].map((el) =>
      el.getAttribute('title'),
    );
    expect(titles.some((t) => t?.includes('%'))).toBe(true);
  });
});
