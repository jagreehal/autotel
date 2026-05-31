/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, fireEvent, screen } from '@testing-library/svelte';
import WaterfallRow, {
  type SpanNode,
} from '../components/WaterfallRow.svelte';
import type { SpanData, TraceData } from '../types';

function makeSpan(overrides: Partial<SpanData> = {}): SpanData {
  return {
    traceId: 'trace-1',
    spanId: 'span-1',
    name: 'op',
    kind: 'INTERNAL',
    startTime: 1000,
    endTime: 1100,
    duration: 100,
    attributes: {},
    status: { code: 'OK' },
    events: [
      { name: 'cache_miss', timestamp: 1050, attributes: { key: 'user:1' } },
    ],
    ...overrides,
  };
}

function renderRow(span: SpanData) {
  const node: SpanNode = { span, children: [], depth: 0 };
  const trace: TraceData = {
    traceId: span.traceId,
    correlationId: span.traceId.slice(0, 16),
    rootSpan: span,
    spans: [span],
    startTime: span.startTime,
    endTime: span.endTime,
    duration: span.duration,
    status: 'OK',
    service: 'svc',
  };
  return render(WaterfallRow, {
    props: {
      node,
      trace,
      isSelected: false,
      isCollapsed: false,
      hasChildren: false,
      isCritical: false,
    },
  });
}

describe('WaterfallRow — event popover', () => {
  afterEach(cleanup);

  it('opens an event detail popover when a marker is clicked', async () => {
    renderRow(makeSpan());
    expect(screen.queryByText('user:1')).toBeNull();

    await fireEvent.click(screen.getByLabelText('Event cache_miss'));

    expect(screen.getByText('user:1')).toBeTruthy();
  });

  it('closes the popover on an outside click', async () => {
    renderRow(makeSpan());
    await fireEvent.click(screen.getByLabelText('Event cache_miss'));
    expect(screen.getByText('user:1')).toBeTruthy();

    await fireEvent.click(document.body);

    expect(screen.queryByText('user:1')).toBeNull();
  });

  it('closes the popover when Escape is pressed', async () => {
    renderRow(makeSpan());
    await fireEvent.click(screen.getByLabelText('Event cache_miss'));
    expect(screen.getByText('user:1')).toBeTruthy();

    await fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByText('user:1')).toBeNull();
  });
});
