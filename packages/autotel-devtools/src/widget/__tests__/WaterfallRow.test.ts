/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, fireEvent, screen } from '@testing-library/svelte';
import WaterfallRow from '../components/WaterfallRow.svelte';
import type { SpanData, SpanNode, TraceData } from '../types';

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

function renderRow(span: SpanData, repeatCount?: number) {
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
      repeatCount,
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

describe('WaterfallRow — database badges', () => {
  afterEach(cleanup);

  it('marks a full scan and a statement repeated in the trace', () => {
    renderRow(makeSpan({ attributes: { 'db.plan.full_scan': true } }), 5);
    expect(screen.getByText('FULL SCAN')).toBeTruthy();
    expect(screen.getByText('×5')).toBeTruthy();
  });

  it('shows neither on an ordinary span', () => {
    renderRow(makeSpan({ attributes: { 'db.plan.full_scan': false } }));
    expect(screen.queryByText('FULL SCAN')).toBeNull();
    expect(screen.queryByText(/^×/)).toBeNull();
  });
});

describe('WaterfallRow: app attribute preview', () => {
  afterEach(cleanup);

  it('shows the first three app attributes by short key, never auto ones', () => {
    renderRow(
      makeSpan({
        events: [],
        attributes: {
          'service.name': 'worker',
          'code.function': 'sendUser',
          'user.id': 'u4',
          'statements.outcome': 'send_failed',
          'statements.retries': 2,
          'statements.channel': 'email',
        },
      }),
    );
    expect(screen.getByText('id=')).toBeTruthy();
    expect(screen.getByText('u4')).toBeTruthy();
    expect(screen.getByText('send_failed')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.queryByText('email')).toBeNull();
    expect(screen.queryByText('worker')).toBeNull();
    expect(screen.queryByText('sendUser')).toBeNull();
  });

  it('masks credential-shaped values', () => {
    renderRow(
      makeSpan({ events: [], attributes: { 'auth.token': 'secret-value' } }),
    );
    expect(screen.queryByText('secret-value')).toBeNull();
    expect(screen.getByText('[redacted]')).toBeTruthy();
  });

  it('renders no preview when the app set nothing', () => {
    const { container } = renderRow(
      makeSpan({ events: [], attributes: { 'http.route': '/r' } }),
    );
    expect(container.textContent).not.toContain('=');
  });
});
