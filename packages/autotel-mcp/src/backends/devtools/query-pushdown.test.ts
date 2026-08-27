/**
 * Query pushdown for the devtools backend.
 *
 * The backend used to fetch the whole in-memory trace buffer and filter it in
 * JavaScript, because devtools had no server-side query language. It now has
 * one, so a structured `TraceSearchQuery` can be compiled into query text and
 * executed as SQL against the whole retained history instead of against the
 * hundred-trace live tail.
 *
 * The seam is the compiler: query object in, query text out. Getting it wrong
 * silently *widens* a search — a dropped filter returns more than was asked
 * for, which reads as "the data is there" rather than as a bug. So the
 * operators it declines to emit are tested as carefully as the ones it does.
 */

import { describe, it, expect } from 'vitest';
import { compileTraceQuery } from './query-pushdown';
import { parse } from 'autotel-devtools/query';

describe('compileTraceQuery — scalar filters', () => {
  it('compiles an empty query to empty text, matching everything', () => {
    expect(compileTraceQuery({})).toBe('');
  });

  it('compiles a service filter', () => {
    expect(compileTraceQuery({ service: 'api' })).toBe('service = "api"');
  });

  it('maps operation onto the span name column', () => {
    expect(compileTraceQuery({ operation: 'GET /users' })).toBe(
      'name = "GET /users"',
    );
  });

  it('escapes a quote inside a value rather than breaking the expression', () => {
    expect(compileTraceQuery({ service: 'we"ird' })).toBe(
      String.raw`service = "we\"ird"`,
    );
  });

  it('escapes a backslash', () => {
    expect(compileTraceQuery({ service: String.raw`a\b` })).toBe(
      String.raw`service = "a\\b"`,
    );
  });

  it('leaves aggregate duration bounds for the hydrated trace matcher', () => {
    expect(compileTraceQuery({ minDurationMs: 100 })).toBe('');
    expect(compileTraceQuery({ maxDurationMs: 250 })).toBe('');
  });

  it('leaves aggregate status filters for the hydrated trace matcher', () => {
    expect(compileTraceQuery({ hasError: true })).toBe('');
    expect(compileTraceQuery({ statusCode: 'ERROR' })).toBe('');
  });

  it('omits the error filter when false rather than asking for non-errors', () => {
    // `hasError: false` means "do not restrict", not "exclude errors".
    expect(compileTraceQuery({ hasError: false })).toBe('');
  });

  it('pushes down only the predicates that must match the same span', () => {
    expect(
      compileTraceQuery({
        service: 'api',
        operation: 'GET /users',
        minDurationMs: 100,
        hasError: true,
      }),
    ).toBe('service = "api" AND name = "GET /users"');
  });
});

describe('compileTraceQuery — tags', () => {
  it('compiles a tag as a quoted attribute comparison', () => {
    expect(compileTraceQuery({ tags: { 'http.status_code': 500 } })).toBe(
      '"http.status_code" = 500',
    );
  });

  it('quotes a key containing a space, which a bare word cannot spell', () => {
    expect(compileTraceQuery({ tags: { 'user id': 'u1' } })).toBe(
      '"user id" = "u1"',
    );
  });

  it('emits a boolean bare rather than quoting it as text', () => {
    expect(compileTraceQuery({ tags: { cached: true } })).toBe(
      '"cached" = true',
    );
  });
});

describe('compileTraceQuery — trace-wide filters', () => {
  it('leaves generic filters for the hydrated trace matcher', () => {
    expect(
      compileTraceQuery({
        service: 'api',
        filters: [{ field: 'http.status_code', operator: 'gte', value: 500 }],
      }),
    ).toBe('service = "api"');
  });
});

describe('compileTraceQuery — output parses', () => {
  it('emits text the devtools parser accepts', () => {
    // The compiler is only useful if what it emits actually parses. Checked
    // against the real grammar, imported from devtools, so the two cannot drift
    // into a 400 for a query the user never typed.
    const cases = [
      compileTraceQuery({}),
      compileTraceQuery({ service: 'api', hasError: true }),
      compileTraceQuery({ tags: { 'http.status_code': 500, cached: false } }),
      compileTraceQuery({
        filters: [
          { field: 'service', operator: 'in', value: ['api', 'web'] },
          { field: 'user.id', operator: 'exists' },
          { field: 'duration', operator: 'between', value: [1, 2] },
          { field: 'name', operator: 'contains', value: 'checkout' },
        ],
      }),
      compileTraceQuery({ service: String.raw`we"ird \ name` }),
    ];

    for (const text of cases) {
      expect(parse(text).ok, `failed to parse: ${text}`).toBe(true);
    }
  });

  it('round-trips the safe candidate predicates', () => {
    // Beyond parsing, the tree must actually say what the filter meant.
    const result = parse(compileTraceQuery({ service: 'api', hasError: true }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.node.type).toBe('comparison');
  });
});
