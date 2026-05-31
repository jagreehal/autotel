/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import SpanDetailPanel from '../components/SpanDetailPanel.svelte';
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
    ...overrides,
  };
}

function makeTrace(span: SpanData): TraceData {
  return {
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
}

describe('SpanDetailPanel — code location', () => {
  afterEach(cleanup);

  it('renders a clickable editor deep-link from code.* attributes', () => {
    const span = makeSpan({
      attributes: {
        'code.filepath': '/Users/me/app/src/users.ts',
        'code.lineno': 42,
      },
    });
    render(SpanDetailPanel, {
      props: { span, trace: makeTrace(span), onClose: () => {} },
    });

    const link = screen.getByText('users.ts:42').closest('a');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe(
      'vscode://file/Users/me/app/src/users.ts:42',
    );
  });

  it('omits the Code Location section when there are no code.* attributes', () => {
    const span = makeSpan({ attributes: { 'http.method': 'GET' } });
    render(SpanDetailPanel, {
      props: { span, trace: makeTrace(span), onClose: () => {} },
    });
    expect(screen.queryByText('Code Location')).toBeNull();
  });
});

describe('SpanDetailPanel — database', () => {
  afterEach(cleanup);

  it('renders the database section with the system and SQL statement', () => {
    const span = makeSpan({
      attributes: {
        'db.system': 'postgresql',
        'db.statement': 'SELECT id FROM users',
        'db.sql.table': 'users',
      },
    });
    render(SpanDetailPanel, {
      props: { span, trace: makeTrace(span), onClose: () => {} },
    });

    expect(screen.getByText('Database')).toBeTruthy();
    // `postgresql` shows in the system badge (and also in the raw attributes list).
    expect(screen.getAllByText('postgresql').length).toBeGreaterThanOrEqual(1);
    // SQL is tokenised; `users` appears in both the table field and the query.
    expect(screen.getAllByText('users').length).toBeGreaterThanOrEqual(1);
  });
});
