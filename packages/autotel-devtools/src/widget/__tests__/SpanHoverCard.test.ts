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
  attributes: { model: 'claude-opus-5', 'http.route': '/v1/messages', junk: 1 },
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

  it('shows the full name, timing, status and only the key attributes', () => {
    render(SpanHoverCard, { props: { node, trace } });
    expect(screen.getByText('claude_code.llm_request')).toBeTruthy();
    expect(screen.getByText('25% of trace')).toBeTruthy();
    expect(screen.getByText('+250ms')).toBeTruthy();
    expect(screen.getByText('rate limited')).toBeTruthy();
    expect(screen.getByText('1 child · 1 event')).toBeTruthy();
    expect(screen.getByText('claude-opus-5')).toBeTruthy();
    expect(screen.queryByText('junk')).toBeNull();
  });
});
