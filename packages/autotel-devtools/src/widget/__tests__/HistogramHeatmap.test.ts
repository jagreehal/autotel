/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/svelte';
import HistogramHeatmap from '../components/charts/HistogramHeatmap.svelte';
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

describe('HistogramHeatmap', () => {
  afterEach(cleanup);

  it('renders a cell per bucket per column', () => {
    const { container } = render(HistogramHeatmap, {
      props: { points: [column(0, [1, 2, 3]), column(1, [3, 2, 1])] },
    });
    // 3 buckets × 2 columns.
    expect(container.querySelectorAll('button')).toHaveLength(6);
  });

  it('labels each row by its bucket range', () => {
    render(HistogramHeatmap, { props: { points: [column(0, [1, 1, 1])] } });
    expect(screen.getByText(/≤10/)).toBeTruthy();
    expect(screen.getByText(/10–100/)).toBeTruthy();
    expect(screen.getByText(/>100/)).toBeTruthy();
  });

  it('puts the largest bucket at the top, as a distribution is read', () => {
    const { container } = render(HistogramHeatmap, {
      props: { points: [column(0, [1, 1, 1])] },
    });
    const labels = [...container.querySelectorAll('.text-right > div')].map(
      (el) => el.textContent?.trim(),
    );
    expect(labels[0]).toMatch(/>100/);
    expect(labels[labels.length - 1]).toMatch(/≤10/);
  });

  it('says so when nothing in the window carries buckets', () => {
    render(HistogramHeatmap, {
      props: { points: [{ timestamp: T0, attributes: {}, value: 5 }] },
    });
    expect(screen.getByText(/No bucketed data/)).toBeTruthy();
  });

  it('renders an empty state rather than an empty grid for no points', () => {
    render(HistogramHeatmap, { props: { points: [] } });
    expect(screen.getByText(/No bucketed data/)).toBeTruthy();
  });

  it('keeps a quiet cell visible beside a spike', () => {
    // Without a floor on opacity, a count of 1 next to 9000 is
    // indistinguishable from empty — which would read as "nothing happened".
    const { container } = render(HistogramHeatmap, {
      props: { points: [column(0, [1, 9000, 0])] },
    });
    const cells = [...container.querySelectorAll('button')];
    const styles = cells.map((c) => c.getAttribute('style') ?? '');
    const quiet = styles.find((s) => s.includes('color-mix'));
    expect(quiet).toBeTruthy();
    // The empty cell uses the flat subtle token, not a mix — so the two differ.
    expect(styles.some((s) => s.includes('var(--color-subtle)'))).toBe(true);
  });

  it('names the bucket, time and count on each cell for assistive tech', () => {
    render(HistogramHeatmap, { props: { points: [column(0, [7, 0, 0])] } });
    const cell = screen.getByLabelText(/≤10 at .*: 7 observations/);
    expect(cell).toBeTruthy();
  });

  it('reports the busiest count for the legend scale', () => {
    render(HistogramHeatmap, { props: { points: [column(0, [1, 42, 3])] } });
    expect(screen.getByText(/busiest 42/)).toBeTruthy();
  });

  it('calls onCell with the column time and row index', () => {
    const onCell = vi.fn();
    render(HistogramHeatmap, {
      props: { points: [column(0, [1, 0, 0])], onCell },
    });

    fireEvent.click(screen.getByLabelText(/≤10 at .*: 1 observation/));
    expect(onCell).toHaveBeenCalledWith(T0, 0);
  });

  it('appends the unit to the row labels', () => {
    render(HistogramHeatmap, {
      props: { points: [column(0, [1, 1, 1])], unit: 'ms' },
    });
    expect(screen.getAllByText('ms').length).toBeGreaterThan(0);
  });
});
