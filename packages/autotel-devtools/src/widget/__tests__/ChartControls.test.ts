/**
 * @vitest-environment jsdom
 *
 * Which controls appear for which instrument.
 *
 * The rule is that a meaningless combination is *hidden*, not disabled: a
 * disabled button makes the reader work out why. So most of these tests are
 * about absence — stacked latencies, a gauge's "rate", a distribution mode for
 * a counter that has no buckets.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/svelte';
import ChartControls from '../components/charts/ChartControls.svelte';

const noop = () => {};
const base = {
  mode: 'timeseries' as const,
  onMode: noop,
  aggregate: 'sum' as const,
  onAggregate: noop,
  stacked: false,
  onStacked: noop,
  rate: false,
  onRate: noop,
};

describe('ChartControls — what is offered', () => {
  afterEach(cleanup);

  it('offers rate and stacking for a counter', () => {
    render(ChartControls, { props: { ...base, kind: 'sum' } });
    expect(screen.getByText('Rate')).toBeTruthy();
    expect(screen.getByText('Stack')).toBeTruthy();
  });

  it('offers neither rate nor stacking for a gauge', () => {
    // A gauge is a level. "Rate of memory used" is not a thing, and stacked
    // levels sum to a number nobody measured.
    render(ChartControls, { props: { ...base, kind: 'gauge' } });
    expect(screen.queryByText('Rate')).toBeNull();
    expect(screen.queryByText('Stack')).toBeNull();
  });

  it('offers the distribution modes only for a histogram', () => {
    render(ChartControls, { props: { ...base, kind: 'histogram' } });
    expect(screen.getByText('Heatmap')).toBeTruthy();
    expect(screen.getByText('Percentiles')).toBeTruthy();
  });

  it('hides the mode switch entirely when there is only one mode', () => {
    // A single-option toggle is a control that cannot be used.
    render(ChartControls, { props: { ...base, kind: 'sum' } });
    expect(screen.queryByRole('group', { name: 'Chart type' })).toBeNull();
  });

  it('offers stacking for a histogram, whose counts do add up', () => {
    render(ChartControls, { props: { ...base, kind: 'histogram' } });
    expect(screen.getByText('Stack')).toBeTruthy();
  });

  it('does not offer rate for a histogram, which is not a counter', () => {
    render(ChartControls, { props: { ...base, kind: 'histogram' } });
    expect(screen.queryByText('Rate')).toBeNull();
  });

  it('hides the time-series controls in a distribution mode', () => {
    // Summarising or stacking does not apply to a heatmap.
    render(ChartControls, {
      props: { ...base, kind: 'histogram', mode: 'heatmap' },
    });
    expect(screen.queryByLabelText('Summary statistic')).toBeNull();
    expect(screen.queryByText('Stack')).toBeNull();
  });
});

describe('ChartControls — interaction', () => {
  afterEach(cleanup);

  it('emits a mode change', async () => {
    const onMode = vi.fn();
    render(ChartControls, { props: { ...base, kind: 'histogram', onMode } });

    await fireEvent.click(screen.getByText('Heatmap'));
    expect(onMode).toHaveBeenCalledWith('heatmap');
  });

  it('marks the active mode for assistive tech, not just visually', () => {
    render(ChartControls, {
      props: { ...base, kind: 'histogram', mode: 'percentiles' },
    });
    const active = screen.getByText('Percentiles').closest('button');
    expect(active?.getAttribute('aria-pressed')).toBe('true');
  });

  it('offers every summary statistic', () => {
    render(ChartControls, { props: { ...base, kind: 'sum' } });
    const select = screen.getByLabelText('Summary statistic');
    const options = [...select.querySelectorAll('option')].map((o) => o.value);
    expect(options).toEqual(['sum', 'avg', 'min', 'max', 'last', 'count']);
  });

  it('emits an aggregate change', async () => {
    const onAggregate = vi.fn();
    render(ChartControls, { props: { ...base, kind: 'sum', onAggregate } });

    await fireEvent.change(screen.getByLabelText('Summary statistic'), {
      target: { value: 'avg' },
    });
    expect(onAggregate).toHaveBeenCalledWith('avg');
  });

  it('emits a stack toggle', async () => {
    const onStacked = vi.fn();
    render(ChartControls, { props: { ...base, kind: 'sum', onStacked } });

    const checkbox = screen
      .getByText('Stack')
      .closest('label')
      ?.querySelector('input');
    await fireEvent.click(checkbox!);
    expect(onStacked).toHaveBeenCalledWith(true);
  });

  it('emits a rate toggle', async () => {
    const onRate = vi.fn();
    render(ChartControls, { props: { ...base, kind: 'sum', onRate } });

    const checkbox = screen
      .getByText('Rate')
      .closest('label')
      ?.querySelector('input');
    await fireEvent.click(checkbox!);
    expect(onRate).toHaveBeenCalledWith(true);
  });

  it('reflects the current toggle state', () => {
    render(ChartControls, {
      props: { ...base, kind: 'sum', stacked: true, rate: true },
    });
    const stack = screen
      .getByText('Stack')
      .closest('label')
      ?.querySelector('input') as HTMLInputElement;
    expect(stack.checked).toBe(true);
  });

  it('explains what rate does, since the word alone is ambiguous', () => {
    render(ChartControls, { props: { ...base, kind: 'sum' } });
    const label = screen.getByText('Rate').closest('label');
    expect(label?.getAttribute('title')).toMatch(/cumulative/i);
  });
});
