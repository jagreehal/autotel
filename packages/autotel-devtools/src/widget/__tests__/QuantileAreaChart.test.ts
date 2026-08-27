/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import QuantileAreaChart from '../components/charts/QuantileAreaChart.svelte';
import type { MetricPoint } from '../../server/metric-streams';

const T0 = 1_700_000_000_000;
const BOUNDS = [10, 100];

function column(offset: number, counts: number[]): MetricPoint {
  return {
    timestamp: T0 + offset * 1000,
    attributes: {},
    count: counts.reduce((sum, n) => sum + n, 0),
    bucketCounts: counts,
    explicitBounds: BOUNDS,
  };
}

const series = [
  column(0, [5, 3, 2]),
  column(1, [4, 4, 2]),
  column(2, [2, 5, 3]),
];

describe('QuantileAreaChart', () => {
  afterEach(cleanup);

  it('draws a band and a line per quantile', () => {
    const { container } = render(QuantileAreaChart, {
      props: { points: series },
    });
    for (const label of ['p50', 'p90', 'p99']) {
      expect(
        container.querySelector(`[data-testid="band-${label}"]`),
      ).not.toBeNull();
      expect(
        container.querySelector(`[data-testid="line-${label}"]`),
      ).not.toBeNull();
    }
  });

  it('honours a custom quantile set', () => {
    const { container } = render(QuantileAreaChart, {
      props: { points: series, quantiles: [0.5, 0.999] },
    });
    expect(container.querySelector('[data-testid="line-p100"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="line-p90"]')).toBeNull();
  });

  it('starts the value axis at zero', () => {
    // A percentile chart that does not start at zero turns a small absolute
    // change into a dramatic-looking one.
    render(QuantileAreaChart, { props: { points: series } });
    expect(screen.getByText('0')).toBeTruthy();
  });

  it('says so when nothing in the window carries buckets', () => {
    render(QuantileAreaChart, {
      props: { points: [{ timestamp: T0, attributes: {}, value: 5 }] },
    });
    expect(screen.getByText(/No bucketed data/)).toBeTruthy();
  });

  it('renders the empty state for no points at all', () => {
    render(QuantileAreaChart, { props: { points: [] } });
    expect(screen.getByText(/No bucketed data/)).toBeTruthy();
  });

  it('produces no NaN coordinates when every point is identical', () => {
    const flat = [column(0, [1, 1, 1]), column(1, [1, 1, 1])];
    const { container } = render(QuantileAreaChart, {
      props: { points: flat },
    });
    expect(container.innerHTML).not.toMatch(/NaN/);
  });

  it('lists the latest value per quantile in the legend', () => {
    const { container } = render(QuantileAreaChart, {
      props: { points: series, unit: 'ms' },
    });
    expect(container.textContent).toContain('p50');
    expect(container.textContent).toMatch(/p50[\s\S]*\d/);
  });

  it('skips an empty histogram point rather than plotting it as zero', () => {
    // A zero p99 reads as "everything was instant". Two columns where one has
    // no observations must therefore behave as one plottable point — too few
    // to make a band.
    const { container } = render(QuantileAreaChart, {
      props: { points: [column(0, [5, 3, 2]), column(1, [0, 0, 0])] },
    });
    expect(container.querySelector('[data-testid="band-p50"]')).toBeNull();
    // The chart still renders, because one track does have a value.
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('reports the empty state when no point has observations at all', () => {
    const { container } = render(QuantileAreaChart, {
      props: { points: [column(0, [0, 0, 0])] },
    });
    expect(container.textContent).toContain('No bucketed data');
  });

  it('names the quantiles it shows for assistive tech', () => {
    render(QuantileAreaChart, { props: { points: series } });
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(
      /p50, p90, p99/,
    );
  });

  it('draws nothing for a single point, which cannot make a band', () => {
    const { container } = render(QuantileAreaChart, {
      props: { points: [column(0, [1, 1, 1])] },
    });
    expect(container.querySelector('[data-testid="band-p50"]')).toBeNull();
  });
});
