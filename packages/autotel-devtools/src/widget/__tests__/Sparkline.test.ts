/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import Sparkline from '../components/charts/Sparkline.svelte';
import type { MetricPoint } from '../../server/metric-streams';

const T0 = 1_700_000_000_000;
const series = (values: number[]): MetricPoint[] =>
  values.map((value, i) => ({
    timestamp: T0 + i * 1000,
    attributes: {},
    value,
  }));

describe('Sparkline', () => {
  afterEach(cleanup);

  it('draws a path for a series with two or more points', () => {
    const { container } = render(Sparkline, {
      props: { points: series([1, 2, 3]) },
    });
    const path = container.querySelector('path');
    expect(path?.getAttribute('d')).toMatch(/^M/);
  });

  it('draws a flat series without collapsing to NaN', () => {
    // A zero-height domain would divide by zero and produce an undrawable path.
    const { container } = render(Sparkline, {
      props: { points: series([5, 5, 5]) },
    });
    expect(container.querySelector('path')?.getAttribute('d')).not.toMatch(
      /NaN/,
    );
  });

  it('renders a dash for a single point rather than a misleading dot', () => {
    render(Sparkline, { props: { points: series([5]) } });
    expect(screen.getByText('—')).toBeTruthy();
    expect(document.querySelector('path')).toBeNull();
  });

  it('renders a dash for an empty series', () => {
    render(Sparkline, { props: { points: [] } });
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('labels itself for assistive tech', () => {
    render(Sparkline, { props: { points: series([1, 2]) } });
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(
      /2 points/,
    );
  });

  it('accepts a custom label', () => {
    render(Sparkline, {
      props: { points: series([1, 2]), ariaLabel: 'requests per second' },
    });
    expect(screen.getByLabelText('requests per second')).toBeTruthy();
  });

  it('honours explicit dimensions', () => {
    const { container } = render(Sparkline, {
      props: { points: series([1, 2]), width: 240, height: 40 },
    });
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('240');
    expect(svg?.getAttribute('height')).toBe('40');
  });
});
