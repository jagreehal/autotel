/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import TraceHoverCard from '../components/TraceHoverCard.svelte';
import type { SpanData, TraceData } from '../types';

const span = (s: Partial<SpanData> & { spanId: string }): SpanData => ({
  traceId: 't',
  name: s.spanId,
  kind: 'INTERNAL',
  startTime: 0,
  endTime: 0,
  duration: 0,
  attributes: {},
  status: { code: 'OK' },
  ...s,
});

const root = span({
  spanId: 'statements.send',
  endTime: 100,
  duration: 100,
  attributes: {
    'service.name': 'worker',
    'statements.batch_id': 'b-17',
    'auth.token': 'secret-value',
    'http.route': '/send',
  },
  status: { code: 'ERROR' },
});
const trace: TraceData = {
  traceId: 't',
  correlationId: 't',
  rootSpan: root,
  spans: [
    root,
    span({
      spanId: 'smtp.send',
      parentSpanId: 'statements.send',
      startTime: 10,
      endTime: 90,
      duration: 80,
      attributes: { 'service.name': 'mailer' },
      status: { code: 'ERROR', message: 'SMTP 550 mailbox unavailable' },
    }),
  ],
  startTime: 0,
  endTime: 100,
  duration: 100,
  status: 'ERROR',
  service: 'worker',
};

describe('TraceHoverCard', () => {
  afterEach(cleanup);

  it('says what failed, which services it crossed, and where the time went', () => {
    render(TraceHoverCard, { trace });
    const card = screen.getByRole('tooltip');
    expect(screen.getByText('worker')).toBeTruthy();
    expect(screen.getByText('mailer')).toBeTruthy();
    expect(card.textContent).toContain('2 failed');
    expect(card.textContent).toContain('SMTP 550 mailbox unavailable');
    expect(card.textContent).toContain('Where the time went');
    // The root spent 20ms itself around smtp.send's 80ms; listed in start order.
    expect(card.textContent).toMatch(
      /statements\.send.*20ms.*smtp\.send.*80ms/s,
    );
  });

  it("lists the root span's attributes, app first, credentials masked", () => {
    render(TraceHoverCard, { trace });
    const text = screen.getByRole('tooltip').textContent!;
    expect(text).toContain('b-17');
    expect(text).toContain('[redacted]');
    expect(text).not.toContain('secret-value');
    expect(text.indexOf('statements.batch_id')).toBeLessThan(
      text.indexOf('http.route'),
    );
  });

  it('leaves out what a one-span, one-service, healthy trace has nothing to say about', () => {
    const solo = {
      ...trace,
      status: 'OK' as const,
      spans: [{ ...root, status: { code: 'OK' as const } }],
    };
    render(TraceHoverCard, { trace: solo });
    const text = screen.getByRole('tooltip').textContent!;
    expect(text).not.toContain('failed');
    expect(text).not.toContain('Where the time went');
    expect(screen.queryByText('worker')).toBeNull();
  });
});
