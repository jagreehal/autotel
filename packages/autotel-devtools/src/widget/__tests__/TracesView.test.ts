/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/svelte';
import TracesView from '../components/TracesView.svelte';
import { clearAllData, updateWidgetData } from '../store.svelte';
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
