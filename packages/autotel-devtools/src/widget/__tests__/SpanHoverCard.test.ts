/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import SpanHoverCard from '../components/SpanHoverCard.svelte';
import type { SpanData, SpanNode, TraceData } from '../types';

const span: SpanData = {
  traceId: 't',
  spanId: 's',
  name: 'claude_code.llm_request',
  kind: 'CLIENT',
  startTime: 1250,
  endTime: 1500,
  duration: 250,
  attributes: {
    model: 'claude-opus-5',
    'http.route': '/v1/messages',
    'user.id': 'u4',
    'telemetry.sdk.name': 'opentelemetry',
  },
  status: { code: 'ERROR', message: 'rate limited' },
  events: [{ name: 'retry', timestamp: 1300 }],
};
const child: SpanNode = {
  span: { ...span, spanId: 'c', name: 'child' },
  children: [],
  depth: 1,
};
const node: SpanNode = { span, children: [child], depth: 0 };
const trace: TraceData = {
  traceId: 't',
  correlationId: 't',
  rootSpan: span,
  spans: [span, child.span],
  startTime: 1000,
  endTime: 2000,
  duration: 1000,
  status: 'ERROR',
  service: 'svc',
};

describe('SpanHoverCard', () => {
  afterEach(cleanup);

  it('shows the full name, timing, status, app and key attributes, no resource noise', () => {
    render(SpanHoverCard, { props: { node, trace } });
    expect(screen.getByText('claude_code.llm_request')).toBeTruthy();
    expect(screen.getByText('25% of trace')).toBeTruthy();
    expect(screen.getByText('+250ms')).toBeTruthy();
    expect(screen.getByText('rate limited')).toBeTruthy();
    expect(screen.getByText('1 child · 1 event')).toBeTruthy();
    expect(screen.getByText('claude-opus-5')).toBeTruthy();
    expect(screen.getByText('u4')).toBeTruthy();
    expect(screen.getByText('/v1/messages')).toBeTruthy();
    expect(screen.queryByText('telemetry.sdk.name')).toBeNull();
  });
});

describe('SpanHoverCard: app attributes', () => {
  afterEach(cleanup);

  it('shows full-length values and masks credentials', () => {
    const long = `order-${'x'.repeat(80)}-tail`;
    const s = {
      ...span,
      attributes: { 'order.id': long, 'auth.token': 'secret-value' },
    };
    render(SpanHoverCard, {
      props: { node: { span: s, children: [], depth: 0 }, trace },
    });
    expect(screen.getByText(long)).toBeTruthy();
    expect(screen.queryByText('secret-value')).toBeNull();
    expect(screen.getByText('[redacted]')).toBeTruthy();
  });
});
