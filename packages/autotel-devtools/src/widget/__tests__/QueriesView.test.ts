/**
 * @vitest-environment jsdom
 *
 * QueriesView groups database spans by statement: counts and times across
 * runs, repeats within a trace, and a plan that always names the run it came
 * from, or says why there is none.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/svelte';
import QueriesView from '../components/QueriesView.svelte';
import {
  clearAllData,
  updateWidgetData,
  selectedTabSignal,
  selectedTraceIdSignal,
  selectedSpanIdSignal,
} from '../store.svelte';
import { sampleQueryTraces } from '../components/__fixtures__/queries';

describe('QueriesView', () => {
  beforeEach(() => clearAllData());
  afterEach(() => {
    cleanup();
    clearAllData();
  });

  it('shows how to send database spans when there are none', () => {
    render(QueriesView);
    expect(screen.getByText(/No database spans in this window/)).toBeTruthy();
    expect(screen.getByText(/instrumentMongoose\(mongoose/)).toBeTruthy();
  });

  it('lists each statement once, with its database and plan state', async () => {
    render(QueriesView);
    updateWidgetData({ traces: sampleQueryTraces() });

    expect(await screen.findByText('Queries (6)')).toBeTruthy();
    expect(screen.getByText('find orders')).toBeTruthy();
    expect(screen.getAllByText(/postgresql · blog/).length).toBe(2);
    expect(screen.getByText('Repeated ×5')).toBeTruthy();
    expect(screen.getByText('FULL SCAN')).toBeTruthy();
    expect(screen.getByText('explain failed')).toBeTruthy();
    expect(screen.getByText('nothing to plan')).toBeTruthy();
    expect(screen.getAllByText('explain off').length).toBe(2);
    // Redis: nothing in autotel explains it, so it is not "off".
    expect(screen.getByText('no plan capture')).toBeTruthy();
  });

  it('opens a statement: runs apart from the plan, and the plan names its run', async () => {
    render(QueriesView);
    updateWidgetData({ traces: sampleQueryTraces() });

    await fireEvent.click(await screen.findByText('find orders'));
    expect(screen.getByText(/Across 2 runs in 2 traces/)).toBeTruthy();
    expect(screen.getByText('Plan from one run')).toBeTruthy();
    expect(screen.getByText('executed')).toBeTruthy();
    // The latest plan is the indexed one.
    expect(screen.getByLabelText('Plan stages').textContent).toContain('FETCH');
    expect(screen.getByText(/2 different plans/)).toBeTruthy();

    await fireEvent.click(screen.getByText(/open run/));
    expect(selectedTabSignal.value).toBe('traces');
    expect(selectedTraceIdSignal.value).toBe('t-orders-2');
    expect(selectedSpanIdSignal.value).toBe('find');
  });

  it('says why a plan is missing: failed, or explain off with the setup', async () => {
    render(QueriesView);
    updateWidgetData({ traces: sampleQueryTraces() });

    await fireEvent.click(await screen.findByText('find audit'));
    expect(
      screen.getByText(/Explain failed: not authorized on shop/),
    ).toBeTruthy();

    await fireEvent.click(screen.getByText('SELECT comments'));
    expect(screen.getByText(/No plan: explain is off/)).toBeTruthy();
    expect(screen.getByText(/instrumentDrizzleClient/)).toBeTruthy();

    await fireEvent.click(screen.getByText('GET'));
    expect(
      screen.getByText(/No autotel instrumentation captures redis plans/),
    ).toBeTruthy();
    expect(screen.queryByText(/instrumentMongoose/)).toBeNull();
  });

  it('calls a repeat a possible N+1 and jumps to the trace', async () => {
    render(QueriesView);
    updateWidgetData({ traces: sampleQueryTraces() });

    await fireEvent.click(await screen.findByText('SELECT comments'));
    await fireEvent.click(screen.getByText(/possible N\+1, open it/));
    expect(selectedTraceIdSignal.value).toBe('t-feed');
  });

  it('filters by statement text and by database', async () => {
    render(QueriesView);
    updateWidgetData({ traces: sampleQueryTraces() });
    await screen.findByText('find orders');

    const filter = screen.getByPlaceholderText(/Filter by statement/);
    await fireEvent.input(filter, { target: { value: 'comments' } });
    expect(screen.queryByText('find orders')).toBeNull();
    expect(screen.getByText('SELECT comments')).toBeTruthy();

    await fireEvent.input(filter, { target: { value: 'blog' } });
    expect(screen.queryByText('find orders')).toBeNull();
    expect(screen.getByText('SELECT posts')).toBeTruthy();
  });
});
