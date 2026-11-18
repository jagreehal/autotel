/**
 * @vitest-environment jsdom
 */
import {
  describe,
  it,
  expect,
  afterEach,
  beforeEach,
  onTestFinished,
  vi,
} from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/svelte';
import TracesView from '../components/TracesView.svelte';
import {
  clearAllData,
  setSelectedTrace,
  updateWidgetData,
} from '../store.svelte';
import type { SpanData, TraceData } from '../types';

function makeTrace(id: string, extra: Partial<TraceData> = {}): TraceData {
  const span: SpanData = {
    traceId: id,
    spanId: `${id}-s`,
    name: `op-${id}`,
    kind: 'SERVER',
    startTime: Date.now(),
    endTime: Date.now() + 100,
    duration: 100,
    attributes: {},
    status: { code: 'OK' },
  };
  return {
    traceId: id,
    correlationId: id,
    rootSpan: span,
    spans: [span],
    startTime: span.startTime,
    endTime: span.endTime,
    duration: 100,
    status: 'OK',
    service: 'svc',
    ...extra,
  };
}

describe('TracesView — selection and fragments', () => {
  beforeEach(() => {
    clearAllData();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 503 })),
    );
  });
  afterEach(() => {
    cleanup();
    clearAllData();
    vi.unstubAllGlobals();
  });

  it('shows the bulk actions before anything is selected, disabled with a hint', async () => {
    render(TracesView);
    updateWidgetData({ traces: [makeTrace('a'), makeTrace('b')] });
    await screen.findByText('op-a');

    const exportBtn = screen.getByRole('button', { name: 'Export' });
    expect(exportBtn.hasAttribute('disabled')).toBe(true);
    expect(exportBtn.getAttribute('title')).toMatch(/tick traces/i);

    const boxes = screen.getAllByRole('checkbox');
    await fireEvent.click(boxes[1]); // first row (index 0 is select-all)
    expect(exportBtn.hasAttribute('disabled')).toBe(false);
    expect(exportBtn.textContent).toMatch(/1/);
  });

  it('marks a fragment trace whose root never arrived', async () => {
    render(TracesView);
    updateWidgetData({ traces: [makeTrace('frag', { partial: true })] });
    await screen.findByText('op-frag');
    expect(screen.getByText('partial')).toBeTruthy();
  });
});

describe('TracesView: root span app attributes on hover', () => {
  beforeEach(() => {
    clearAllData();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 503 })),
    );
  });
  afterEach(() => {
    cleanup();
    clearAllData();
    vi.unstubAllGlobals();
  });

  it('hovering anywhere on the row opens the root span card, credentials masked', async () => {
    const trace = makeTrace('a');
    trace.rootSpan.attributes = {
      'service.name': 'worker',
      'statements.batch_id': 'b-17',
      'auth.token': 'secret-value',
    };
    render(TracesView);
    updateWidgetData({ traces: [trace] });
    // Nothing inline on the row.
    expect(screen.queryByText('b-17')).toBeNull();
    // Anywhere on the row, not just the name.
    const row = (await screen.findByText(trace.rootSpan.name)).closest(
      '[data-row-index]',
    )!;
    await fireEvent.mouseEnter(row);
    const card = await screen.findByRole('tooltip');
    expect(card.textContent).toContain('statements.batch_id');
    expect(card.textContent).toContain('b-17');
    expect(card.textContent).toContain('[redacted]');
    expect(card.textContent).not.toContain('secret-value');
  });

  it('Space peeks at the cursor row, Esc closes it', async () => {
    const trace = makeTrace('a');
    trace.rootSpan.attributes = { 'statements.batch_id': 'b-17' };
    render(TracesView);
    updateWidgetData({ traces: [trace] });
    // jsdom has no scrollIntoView; the cursor move calls it.
    Element.prototype.scrollIntoView = () => {};
    onTestFinished(() => {
      // SAFETY: the stub above is the only scrollIntoView on this prototype.
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    });
    const list = await screen.findByRole('listbox', { name: 'Traces' });
    await fireEvent.keyDown(list, { key: 'ArrowDown' });
    await fireEvent.keyDown(list, { key: ' ' });
    expect((await screen.findByRole('tooltip')).textContent).toContain('b-17');
    await fireEvent.keyDown(list, { key: 'Escape' });
    await vi.waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  });

  it('drops the hover card when a trace opens, so Back does not bring it back', async () => {
    const trace = makeTrace('a');
    trace.rootSpan.attributes = { 'order.id': 'o1' };
    render(TracesView);
    updateWidgetData({ traces: [trace] });
    const name = () =>
      screen.queryByText(trace.rootSpan.name, {
        selector: '[data-peek-anchor]',
      });
    const row = (await screen.findByText(trace.rootSpan.name)).closest(
      '[data-row-index]',
    )!;
    await fireEvent.mouseEnter(row);
    await screen.findByRole('tooltip');
    setSelectedTrace(trace.traceId);
    await vi.waitFor(() => expect(name()).toBeNull());
    setSelectedTrace(null);
    await vi.waitFor(() => expect(name()).not.toBeNull());
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
