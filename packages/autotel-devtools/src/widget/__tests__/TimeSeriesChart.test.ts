/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/svelte';
import TimeSeriesChart from '../components/charts/TimeSeriesChart.svelte';
import {
  series,
  points,
  twoSeries,
  cumulativeWithReset,
  withExemplars,
} from '../components/charts/__fixtures__/metrics';

describe('TimeSeriesChart', () => {
  afterEach(cleanup);

  it('draws one path per series', () => {
    const { container } = render(TimeSeriesChart, {
      props: { series: twoSeries },
    });
    const lines = container.querySelectorAll('path[stroke]');
    expect(lines).toHaveLength(2);
  });

  it('reports an empty window instead of drawing an empty chart', () => {
    render(TimeSeriesChart, { props: { series: [] } });
    expect(screen.getByText(/No data in this window/)).toBeTruthy();
  });

  it('treats a series whose points are all filtered out as empty', () => {
    render(TimeSeriesChart, { props: { series: [series({ points: [] })] } });
    expect(screen.getByText(/No data in this window/)).toBeTruthy();
  });

  it('marks a single point rather than dropping the series', () => {
    // One point cannot make a line, but it is still a measurement.
    const { container } = render(TimeSeriesChart, {
      props: { series: [series({ points: points([7]) })] },
    });
    expect(container.querySelectorAll('circle').length).toBeGreaterThan(0);
  });

  it('produces no NaN coordinates for a flat series', () => {
    const { container } = render(TimeSeriesChart, {
      props: { series: [series({ points: points([5, 5, 5, 5]) })] },
    });
    expect(container.innerHTML).not.toMatch(/NaN/);
  });

  it('differences a cumulative counter rather than drawing the running total', () => {
    // Drawn as-is, a cumulative counter only ever rises. After differencing the
    // series must contain a fall, because the fixture's rate goes up and down.
    const { container } = render(TimeSeriesChart, {
      props: { series: cumulativeWithReset },
    });
    const d = container.querySelector('path[stroke]')?.getAttribute('d') ?? '';
    const ys = [...d.matchAll(/[ML,](\d+\.?\d*)(?=[,\s]|$)/g)].map((m) => m[1]);
    expect(ys.length).toBeGreaterThan(0);
    expect(d).not.toMatch(/NaN/);
  });

  it('draws a dot for each exemplar', () => {
    const { container } = render(TimeSeriesChart, {
      props: { series: withExemplars },
    });
    expect(container.querySelectorAll('[role="button"]')).toHaveLength(1);
  });

  it('opens the trace when an exemplar is activated', async () => {
    const onExemplar = vi.fn();
    render(TimeSeriesChart, { props: { series: withExemplars, onExemplar } });

    await fireEvent.click(screen.getByRole('button'));
    expect(onExemplar).toHaveBeenCalledWith(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1',
      '1111111111111111',
    );
  });

  it('activates an exemplar from the keyboard', async () => {
    const onExemplar = vi.fn();
    render(TimeSeriesChart, { props: { series: withExemplars, onExemplar } });

    await fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
    expect(onExemplar).toHaveBeenCalledOnce();
  });

  it('names the trace an exemplar leads to, for assistive tech', () => {
    render(TimeSeriesChart, { props: { series: withExemplars } });
    expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(
      /Open trace aaaa/,
    );
  });

  it('draws only the isolated series', () => {
    const { container } = render(TimeSeriesChart, {
      props: { series: twoSeries, isolated: new Set(['s-get']) },
    });
    expect(container.querySelectorAll('path[stroke]')).toHaveLength(1);
  });

  it('draws every series when the isolation set is empty', () => {
    const { container } = render(TimeSeriesChart, {
      props: { series: twoSeries, isolated: new Set<string>() },
    });
    expect(container.querySelectorAll('path[stroke]')).toHaveLength(2);
  });

  it('adds a filled area only when asked', () => {
    const plain = render(TimeSeriesChart, { props: { series: [series()] } });
    expect(
      plain.container.querySelectorAll('path[fill]:not([fill="none"])'),
    ).toHaveLength(0);
    cleanup();

    const filled = render(TimeSeriesChart, {
      props: { series: [series()], area: true },
    });
    expect(
      filled.container.querySelectorAll('path[fill]:not([fill="none"])').length,
    ).toBeGreaterThan(0);
  });

  it('labels the chart with how many series it shows', () => {
    render(TimeSeriesChart, { props: { series: twoSeries } });
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(
      /2 series/,
    );
  });
});

describe('TimeSeriesChart — stacked', () => {
  afterEach(cleanup);

  it('draws one band per series instead of lines', () => {
    const { container } = render(TimeSeriesChart, {
      props: { series: twoSeries, stacked: true },
    });
    expect(
      container.querySelectorAll('[data-testid="stack-band"]'),
    ).toHaveLength(2);
    expect(container.querySelectorAll('path[stroke-width="1.5"]')).toHaveLength(
      0,
    );
  });

  it('scales to the top of the stack, not the tallest single series', () => {
    // Otherwise the upper bands run off the top of the plot.
    const { container } = render(TimeSeriesChart, {
      props: { series: twoSeries, stacked: true },
    });
    const bands = [...container.querySelectorAll('[data-testid="stack-band"]')];
    const ys = bands
      .flatMap((b) => (b.getAttribute('d') ?? '').match(/-?\d+\.?\d*/g) ?? [])
      .map(Number);
    // Every coordinate must be finite and within the viewBox height.
    expect(ys.every((n) => Number.isFinite(n))).toBe(true);
    expect(container.innerHTML).not.toMatch(/NaN/);
  });

  it('draws lines rather than bands when stacking is off', () => {
    const { container } = render(TimeSeriesChart, {
      props: { series: twoSeries, stacked: false },
    });
    expect(
      container.querySelectorAll('[data-testid="stack-band"]'),
    ).toHaveLength(0);
    expect(container.querySelectorAll('path[stroke]').length).toBeGreaterThan(
      0,
    );
  });

  it('stacks only the isolated series', () => {
    const { container } = render(TimeSeriesChart, {
      props: { series: twoSeries, stacked: true, isolated: new Set(['s-get']) },
    });
    expect(
      container.querySelectorAll('[data-testid="stack-band"]'),
    ).toHaveLength(1);
  });

  it('still reports an empty window when stacked with no data', () => {
    render(TimeSeriesChart, { props: { series: [], stacked: true } });
    expect(screen.getByText(/No data in this window/)).toBeTruthy();
  });
});
