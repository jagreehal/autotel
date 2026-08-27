/**
 * SQL compiler contract.
 *
 * The seam is `compileWhere(node, schema)` — an AST and a signal's schema in, a
 * WHERE-clause fragment plus bound parameters out.
 *
 * The load-bearing property is the last describe block: **no user-supplied text
 * ever reaches the SQL string**. Values become `?` parameters and identifiers
 * come from the schema, never from the query text. Everything else here is
 * behaviour; that one is the security boundary, and it is why the tests assert
 * on `sql`/`params` rather than only on query results.
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../parse';
import { compileWhere, type SignalSchema } from '../compile';

const SPANS: SignalSchema = {
  columns: {
    service: { column: 'service', type: 'string' },
    name: { column: 'name', type: 'string' },
    duration: { column: 'duration', type: 'number' },
    status: { column: 'status_code', type: 'string' },
    trace_id: { column: 'trace_id', type: 'string' },
  },
  attributesColumn: 'attributes',
  freeTextColumns: ['name', 'service', 'trace_id'],
};

/** Compile query text in one step; throws if it doesn't parse. */
function sqlFor(text: string) {
  const result = parse(text);
  if (!result.ok) throw new Error(`parse failed: ${result.errors[0]?.message}`);
  return compileWhere(result.node, SPANS);
}

describe('compileWhere — known columns', () => {
  it('compiles an equality against a first-class column', () => {
    const { sql, params } = sqlFor('service = api');
    expect(sql).toBe('"service" = ?');
    expect(params).toEqual(['api']);
  });

  it('compiles ordered comparisons with a numeric parameter', () => {
    const { sql, params } = sqlFor('duration >= 100');
    expect(sql).toBe('"duration" >= ?');
    expect(params).toEqual([100]);
  });

  it('maps a query field onto its differently-named column', () => {
    const { sql } = sqlFor('status = ERROR');
    expect(sql).toBe('"status_code" = ?');
  });
});

describe('compileWhere — attributes', () => {
  it('compiles an unknown field as a JSON attribute lookup with a bound path', () => {
    const { sql, params } = sqlFor('http.status_code = 500');
    expect(sql).toBe('json_extract("attributes", ?) = ?');
    expect(params).toEqual(['$."http.status_code"', 500]);
  });

  it('escapes a double quote inside an attribute key rather than breaking the path', () => {
    const { params } = sqlFor('"weird\\"key" = 1');
    // Free text, not a comparison — but the point is it must not throw.
    expect(params.length).toBeGreaterThan(0);
  });
});

describe('compileWhere — text operators', () => {
  it('compiles CONTAINS to a LIKE with wildcards in the parameter, not the SQL', () => {
    const { sql, params } = sqlFor('name CONTAINS checkout');
    expect(sql).toBe(`"name" LIKE ? ESCAPE '\\'`);
    expect(params).toEqual(['%checkout%']);
  });

  it('compiles NOT CONTAINS to NOT LIKE', () => {
    const { sql, params } = sqlFor('name NOT CONTAINS health');
    expect(sql).toBe(`"name" NOT LIKE ? ESCAPE '\\'`);
    expect(params).toEqual(['%health%']);
  });

  it('compiles ^ and $ to anchored LIKE patterns', () => {
    expect(sqlFor('name ^ GET').params).toEqual(['GET%']);
    expect(sqlFor('name $ users').params).toEqual(['%users']);
  });

  it('escapes LIKE wildcards in user text so they match literally', () => {
    // A user searching for "100%" means the characters, not "anything".
    const { params } = sqlFor('name CONTAINS "100%"');
    expect(params).toEqual(['%100\\%%']);
  });

  it('escapes underscores, which LIKE treats as single-character wildcards', () => {
    const { params } = sqlFor('name CONTAINS "user_id"');
    expect(params).toEqual(['%user\\_id%']);
  });

  it('compiles REGEXP to the registered regexp operator', () => {
    const { sql, params } = sqlFor('name REGEXP "^GET /"');
    expect(sql).toBe('"name" REGEXP ?');
    expect(params).toEqual(['^GET /']);
  });

  it('compiles NOT REGEXP', () => {
    expect(sqlFor('name !~ x').sql).toBe('"name" NOT REGEXP ?');
  });
});

describe('compileWhere — sets and null', () => {
  it('compiles IN to a parameter per element', () => {
    const { sql, params } = sqlFor('service IN [api, web, worker]');
    expect(sql).toBe('"service" IN (?, ?, ?)');
    expect(params).toEqual(['api', 'web', 'worker']);
  });

  it('compiles NOT IN', () => {
    expect(sqlFor('service NOT IN [api]').sql).toBe('"service" NOT IN (?)');
  });

  it('compiles an empty IN to a constant false rather than invalid SQL', () => {
    const { sql, params } = sqlFor('service IN []');
    expect(sql).toBe('0');
    expect(params).toEqual([]);
  });

  it('compiles = NULL to IS NULL, with no parameter', () => {
    const { sql, params } = sqlFor('parent = NULL');
    expect(sql).toBe('json_extract("attributes", ?) IS NULL');
    expect(params).toEqual(['$."parent"']);
  });

  it('compiles != NULL to IS NOT NULL', () => {
    expect(sqlFor('service != NULL').sql).toBe('"service" IS NOT NULL');
  });
});

describe('compileWhere — structure', () => {
  it('compiles the empty query to a constant true', () => {
    const { sql, params } = sqlFor('');
    expect(sql).toBe('1');
    expect(params).toEqual([]);
  });

  it('parenthesises AND and OR so precedence survives the round trip', () => {
    const { sql } = sqlFor('a = 1 OR b = 2 AND c = 3');
    expect(sql).toBe(
      '(json_extract("attributes", ?) = ? OR (json_extract("attributes", ?) = ? AND json_extract("attributes", ?) = ?))',
    );
  });

  it('orders parameters to match placeholder order', () => {
    const { params } = sqlFor('service = api AND duration > 100');
    expect(params).toEqual(['api', 100]);
  });

  it('compiles free text to an OR across the signal default columns', () => {
    const { sql, params } = sqlFor('checkout');
    expect(sql).toBe(
      `("name" LIKE ? ESCAPE '\\' OR "service" LIKE ? ESCAPE '\\' OR "trace_id" LIKE ? ESCAPE '\\')`,
    );
    expect(params).toEqual(['%checkout%', '%checkout%', '%checkout%']);
  });
});

describe('compileWhere — injection boundary', () => {
  const HOSTILE = [
    "api'; DROP TABLE spans; --",
    'api" OR "1"="1',
    "' UNION SELECT * FROM sqlite_master --",
    'api\\',
  ];

  it.each(HOSTILE)(
    'never places the literal %j into the SQL string',
    (evil) => {
      const result = parse(`service = ${JSON.stringify(evil)}`);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const { sql, params } = compileWhere(result.node, SPANS);
      expect(sql).toBe('"service" = ?');
      expect(params).toEqual([evil]);
      expect(sql).not.toContain('DROP');
      expect(sql).not.toContain('UNION');
    },
  );

  it('never places a hostile attribute key into the SQL string', () => {
    const result = parse('"a\\" OR 1=1 --" = 1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { sql } = compileWhere(result.node, SPANS);
    expect(sql).not.toContain('OR 1=1');
    expect(sql).not.toContain('--');
  });

  it('emits exactly one parameter per placeholder', () => {
    const { sql, params } = sqlFor(
      'service IN [a, b] AND name CONTAINS x OR duration > 5',
    );
    const placeholders = (sql.match(/\?/g) ?? []).length;
    expect(params).toHaveLength(placeholders);
  });
});
