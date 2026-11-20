import { checkRecords } from './profile.js';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { lintContract, parseContract } from './contract.js';
import {
  auditDatabase,
  draftContractFromDatabase,
  introspect,
  quoteIdent,
  quoteLiteral,
  type DatabaseOptions,
  samePhysicalType,
  sampleRows,
} from './db.js';
import { customersYaml } from './__fixtures__/index.js';

const NOW = Date.parse('2026-11-19T12:00:00Z');

/** A legacy table: premium kept as TEXT, a column nobody documented, no status column type, a bad status, a NULL name. */
function legacyDb(): DatabaseOptions {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE customers (
      customer_id TEXT PRIMARY KEY,
      customer_name VARCHAR(100),
      annual_premium TEXT NOT NULL,
      customer_status TEXT,
      legacy_flag CHAR(1)
    );
    INSERT INTO customers VALUES
      ('c1', 'Alex Doe', '120000', 'active', 'Y'),
      ('c2', NULL, '90000', 'lapsed', NULL),
      ('c3', 'Sam Roe', '-1', 'frozen', 'N'),
      ('c4', 'Kim Poe', 'n/a', 'active', 'N');
  `);
  return {
    dialect: 'sqlite',
    query: async (sql) =>
      db.prepare(sql).all() as Array<Record<string, unknown>>,
    now: () => NOW,
  };
}

describe('introspect', () => {
  it('reads tables, types, nullability and primary keys from the catalog', async () => {
    const [t] = await introspect(legacyDb());
    expect(
      t?.columns.map(
        (c) =>
          `${c.name}:${c.dataType}:${c.nullable ? 'null' : 'notnull'}${c.primaryKey ? ':pk' : ''}`,
      ),
    ).toEqual([
      'customer_id:TEXT:null:pk',
      'customer_name:VARCHAR(100):null',
      'annual_premium:TEXT:notnull',
      'customer_status:TEXT:null',
      'legacy_flag:CHAR(1):null',
    ]);
  });
});

describe('auditDatabase', () => {
  it('shows a legacy table against its contract: drift, variances, unknowns, rules, SLAs', async () => {
    const { contract } = parseContract(customersYaml);
    const [r] = await auditDatabase(contract, legacyDb());
    const f = (code: string) =>
      r!.findings.filter((x) => x.code === code).map((x) => x.path);
    expect(r!.rows).toBe(4);
    expect(f('missing-column')).toEqual(['last_updated_at']);
    expect(f('unknown-column')).toEqual(['legacy_flag']);
    expect(f('physical-type-drift')).toEqual(['annual_premium']); // TEXT where INTEGER is promised
    expect(f('nullable-drift')).toEqual(['customer_id', 'customer_name']);
    expect(f('required-missing')).toEqual(['customer_name']);
    expect(f('type-mismatch')).toEqual(['annual_premium']); // 'n/a', even read leniently
    expect(f('below-minimum')).toEqual(['annual_premium']);
    expect(f('invalid-value')).toEqual(['customer_status']);
    const q = Object.fromEntries(
      r!.quality.map((x) => [
        x.rule.description ?? `${x.property}:${x.metric}`,
        x,
      ]),
    );
    expect(q['Expect at least 3 rows']).toMatchObject({
      value: 4,
      passed: true,
    });
    expect(q['Expect less than 1% empty name fields']).toMatchObject({
      value: 0.25,
      passed: false,
    });
    expect(q['Only valid customer statuses']).toMatchObject({
      value: 1,
      passed: false,
    });
    expect(q['customer_id:duplicateValues']).toMatchObject({
      value: 0,
      passed: true,
    });
    // The freshness element is the missing column: reported as not kept, not a crash.
    // The article's retention has no element: unknown, never silently kept.
    expect(r!.sla).toEqual([
      expect.objectContaining({
        property: 'retention',
        status: 'unknown',
        error: expect.stringMatching(/no element/),
      }),
      expect.objectContaining({
        property: 'freshness',
        status: 'unknown',
        error: expect.stringMatching(/no such column/),
      }),
    ]);
    expect(r!.passed).toBe(false);
  });

  it('reports a table the database does not have', async () => {
    const { contract } = parseContract(customersYaml);
    contract.schema![0]!.physicalName = 'clients';
    const [r] = await auditDatabase(contract, legacyDb());
    expect(r!.findings[0]).toMatchObject({ code: 'missing-column', path: '$' });
  });
});

describe('draftContractFromDatabase', () => {
  it('drafts a valid ODCS contract from the database as it is', async () => {
    const draft = await draftContractFromDatabase(legacyDb(), {
      id: 'customers',
      server: { server: 'local', type: 'sqlite' },
    });
    expect(lintContract(draft).filter((i) => i.severity === 'error')).toEqual(
      [],
    );
    const props = Object.fromEntries(
      draft.schema![0]!.properties!.map((p) => [p.name, p]),
    );
    expect(props.customer_id).toMatchObject({
      primaryKey: true,
      logicalType: 'string',
    });
    expect(props.annual_premium).toMatchObject({
      required: true,
      physicalType: 'TEXT',
    });
    expect(props.legacy_flag?.required).toBeUndefined();
    expect(draft.status).toBe('draft');
  });
});

describe('quoting', () => {
  it('quotes identifiers and literals so contract text cannot become SQL', () => {
    expect(quoteIdent('postgres', 'a"b')).toBe('"a""b"');
    expect(quoteIdent('mysql', 'a`b')).toBe('`a``b`');
    expect(quoteLiteral('postgres', "o'neil")).toBe("'o''neil'");
    expect(quoteLiteral('mysql', String.raw`a\' OR 1=1`)).toBe(
      String.raw`'a\\'' OR 1=1'`,
    );
    expect(quoteLiteral('ansi', 3)).toBe('3');
  });
});

describe('audit status', () => {
  it('reports a failing quality query as incomplete, never as passed', async () => {
    const { contract } = parseContract(customersYaml);
    const db = legacyDb();
    const broken: DatabaseOptions = {
      ...db,
      query: async (sql) =>
        sql.includes('TRIM(')
          ? Promise.reject(new Error('no TRIM here'))
          : db.query(sql),
    };
    const [r] = await auditDatabase(contract, broken);
    expect(
      r!.quality.find((q) => q.rule.description?.includes('empty name')),
    ).toMatchObject({
      status: 'not-run',
      skipped: 'query failed', // the driver's message stays out of the report
    });
  });
});

describe('audit failure modes', () => {
  const twoTables = () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE customers (customer_id TEXT PRIMARY KEY, code TEXT, updated_at TEXT);
      INSERT INTO customers VALUES ('c1', 'AB-1', '2026-11-19T11:00:00Z'), ('c2', 'AB-2', '2026-11-19T11:00:00Z'),
                                   ('c3', 'AB-3', '2026-11-19T11:00:00Z'), ('c4', 'bad', '2026-11-19T11:00:00Z');
      CREATE TABLE orders (order_id TEXT PRIMARY KEY);
      INSERT INTO orders VALUES ('o1');
    `);
    return db;
  };
  const contract = parseContract({
    apiVersion: 'v3.2.0',
    kind: 'DataContract',
    id: 'shop',
    version: '1.0.0',
    status: 'active',
    schema: [
      {
        name: 'customers',
        properties: [
          { name: 'customer_id', logicalType: 'string', description: 'id' },
          {
            name: 'code',
            logicalType: 'string',
            description: 'code',
            quality: [
              {
                metric: 'invalidValues',
                arguments: { pattern: '^AB-\\d$' },
                mustBe: 0,
              },
            ],
          },
          {
            name: 'updated_at',
            logicalType: 'timestamp',
            description: 'updated',
          },
        ],
      },
      {
        name: 'orders',
        properties: [
          { name: 'order_id', logicalType: 'string', description: 'id' },
        ],
      },
    ],
    slaProperties: [
      {
        property: 'freshness',
        value: 1,
        unit: 'd',
        element: 'customers.updated_at',
      },
    ],
  }).contract;
  const opts = (
    db: DatabaseSync,
    over: Partial<DatabaseOptions> = {},
  ): DatabaseOptions => ({
    dialect: 'sqlite',
    now: () => NOW,
    query: async (sql) =>
      db.prepare(sql).all() as Array<Record<string, unknown>>,
    ...over,
  });
  const patternRule = (r: {
    quality: Array<{
      metric: string;
      status: string;
      skipped?: string;
      value?: number;
    }>;
  }) => r.quality.find((q) => q.metric === 'invalidValues')!;

  it('carries a stable reason, never the driver message, and hands the error to onQueryError', async () => {
    const db = twoTables();
    const seen: unknown[] = [];
    const failing = opts(db, {
      query: async (sql) => {
        if (sql === 'SELECT COUNT(*) AS v FROM "customers"')
          throw Object.assign(
            new Error('value "alex@example.com" is invalid'),
            { code: '23514' },
          );
        return db.prepare(sql).all() as Array<Record<string, unknown>>;
      },
      onQueryError: (e) => seen.push(e),
    });
    const [r] = await auditDatabase(contract, failing);
    expect(r!.unchecked).toContain('row count: query failed (23514)');
    expect(r!.status).not.toBe('passed');
    expect(JSON.stringify(r)).not.toContain('alex@');
    expect(seen).toHaveLength(1);
  });

  it('tells onQueryError once per failed query, with the statement that failed', async () => {
    const db = twoTables();
    const seen: string[] = [];
    await auditDatabase(
      contract,
      opts(db, {
        query: async (sql) => {
          if (sql.includes('typeof(')) throw new Error('storage check failed');
          return db.prepare(sql).all() as Array<Record<string, unknown>>;
        },
        onQueryError: (_, sql) => seen.push(sql),
      }),
    );
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((q) => q.includes('typeof('))).toBe(true);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('a failed sample or row count leaves that table incomplete and audits the next', async () => {
    for (const broken of [
      'SELECT * FROM "customers"',
      'SELECT COUNT(*) AS v FROM "customers"',
    ]) {
      const db = twoTables();
      const failing = opts(db, {
        query: async (sql) =>
          sql.startsWith(broken)
            ? Promise.reject(new Error('boom'))
            : (db.prepare(sql).all() as Array<Record<string, unknown>>),
      });
      const [customers, orders] = await auditDatabase(contract, failing);
      // The sample's bad row still fails the table when only the count broke; nothing passes.
      expect(customers!.status).not.toBe('passed');
      expect(customers!.unchecked).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^(sample|row count): query failed$/),
        ]),
      );
      expect(orders!.status).toBe('passed');
    }
  });

  it('never lets an absent or partial sample pass a rule with no SQL form', async () => {
    const off = await auditDatabase(
      contract,
      opts(twoTables(), { sampleSize: 0 }),
    );
    expect(patternRule(off[0]!)).toMatchObject({
      status: 'not-run',
      skipped: expect.stringMatching(/no sample was read/),
    });
    expect(off[0]!.status).toBe('incomplete');

    const partial = await auditDatabase(
      contract,
      opts(twoTables(), { sampleSize: 3 }),
    ); // the bad row is the 4th
    expect(patternRule(partial[0]!)).toMatchObject({
      status: 'not-run',
      skipped: expect.stringMatching(/read 3 of 4 rows/),
    });
    expect(partial[0]!.status).toBe('incomplete');

    const db = twoTables();
    db.exec(`UPDATE customers SET code = 'bad' WHERE customer_id = 'c1'`); // now inside the sample
    const caught = await auditDatabase(contract, opts(db, { sampleSize: 2 }));
    expect(patternRule(caught[0]!)).toMatchObject({
      status: 'failed',
      sampled: true,
    });

    const whole = await auditDatabase(contract, opts(twoTables()));
    expect(patternRule(whole[0]!)).toMatchObject({
      status: 'failed',
      value: 1,
    });
  });

  it('a row inserted between the row count and the sample never makes a partial sample complete', async () => {
    const db = twoTables();
    db.exec(`UPDATE customers SET code = 'AB-4' WHERE customer_id = 'c4'`); // clean, 4 rows
    let inserted = false;
    const [r] = await auditDatabase(
      contract,
      opts(db, {
        sampleSize: 4,
        query: async (sql) => {
          const rows = db.prepare(sql).all() as Array<Record<string, unknown>>;
          if (
            !inserted &&
            sql.startsWith('SELECT COUNT(*) AS v FROM "customers"')
          ) {
            inserted = true; // a writer commits right after the count
            db.exec(
              `INSERT INTO customers VALUES ('c5', 'bad', '2026-11-19T11:00:00Z')`,
            );
          }
          return rows;
        },
      }),
    );
    expect(inserted).toBe(true);
    expect(patternRule(r!)).toMatchObject({ status: 'not-run' });
    expect(r!.status).toBe('incomplete');
  });

  it('cannot measure freshness against a future-dated row', async () => {
    const db = twoTables();
    db.exec(
      `INSERT INTO customers VALUES ('c9', 'AB-9', '2027-01-01T00:00:00Z')`,
    );
    const [r] = await auditDatabase(contract, opts(db));
    expect(r!.sla[0]).toMatchObject({
      passed: false,
      error: expect.stringMatching(/clock-skew/),
    });
    expect(r!.status).not.toBe('passed');
  });

  it('reads a sql rule that returns no number as not run, not failed', async () => {
    const c = structuredClone(contract);
    c.schema![1]!.quality = [{ type: 'sql', query: 'SELECT NULL', mustBe: 0 }];
    const [, orders] = await auditDatabase(c, opts(twoTables()));
    expect(orders!.quality[0]).toMatchObject({
      status: 'not-run',
      skipped: 'query returned no number',
    });
    expect(orders!.status).toBe('incomplete');
  });
});

describe('column mapping and rule halves', () => {
  const NOW2 = NOW;
  const exec = (sql: string) => {
    const db = new DatabaseSync(':memory:');
    db.exec(sql);
    return {
      dialect: 'sqlite' as const,
      now: () => NOW2,
      query: async (q: string) =>
        db.prepare(q).all() as Array<Record<string, unknown>>,
    };
  };
  const contractOf = (props: unknown[]) =>
    parseContract({
      apiVersion: 'v3.2.0',
      kind: 'DataContract',
      id: 'x',
      version: '1.0.0',
      status: 'active',
      schema: [{ name: 't', properties: props }],
    }).contract;

  it('reads a column whose physicalName equals its name, or differs only in case', async () => {
    const db = exec(
      `CREATE TABLE t ("P" TEXT, q TEXT); INSERT INTO t VALUES ('v', 'w');`,
    );
    const c = contractOf([
      {
        name: 'p',
        physicalName: 'p',
        logicalType: 'string',
        required: true,
        description: 'p',
      },
      {
        name: 'q',
        physicalName: 'q',
        logicalType: 'string',
        required: true,
        description: 'q',
        quality: [{ metric: 'nullValues', mustBe: 0 }],
      },
    ]);
    const [r] = await auditDatabase(c, db);
    expect(
      r!.findings.filter(
        (f) => f.code === 'required-missing' || f.code === 'missing-column',
      ),
    ).toEqual([]);
    expect(r!.quality[0]).toMatchObject({ status: 'passed', value: 0 });
  });

  it('maps swapped physical names to the right properties', async () => {
    const db = exec(
      `CREATE TABLE t (a INTEGER, b TEXT); INSERT INTO t VALUES (1, 'x');`,
    );
    const c = contractOf([
      {
        name: 'b',
        physicalName: 'a',
        logicalType: 'integer',
        description: 'b',
      },
      { name: 'a', physicalName: 'b', logicalType: 'string', description: 'a' },
    ]);
    const [r] = await auditDatabase(c, db);
    expect(r!.findings.filter((f) => f.severity === 'error')).toEqual([]);
  });

  it('never passes half of an invalidValues rule: a listed value that breaks the pattern, outside the sample', async () => {
    const db = exec(
      `CREATE TABLE t (code TEXT); INSERT INTO t VALUES ('A1'), ('A2'), ('AX');`,
    );
    const c = contractOf([
      {
        name: 'code',
        logicalType: 'string',
        description: 'c',
        quality: [
          {
            metric: 'invalidValues',
            arguments: { validValues: ['A1', 'A2', 'AX'], pattern: '^A\\d$' },
            mustBeLessOrEqualTo: 0.5,
          },
        ],
      },
    ]);
    const partial = await auditDatabase(c, { ...db, sampleSize: 2 });
    expect(partial[0]!.quality[0]).toMatchObject({ status: 'not-run' });
    expect(partial[0]!.status).toBe('incomplete');
    const whole = await auditDatabase(c, db);
    expect(whole[0]!.quality[0]).toMatchObject({ status: 'failed', value: 1 });
  });
});

describe('SQL text and dialects', () => {
  it('substitutes names literally: $& and {property} inside a table name stay as written', async () => {
    for (const name of ['price$&', 'a{property}b']) {
      const db = new DatabaseSync(':memory:');
      db.exec(
        `CREATE TABLE ${quoteIdent('sqlite', name)} (id TEXT); INSERT INTO ${quoteIdent('sqlite', name)} VALUES ('x');`,
      );
      const c = parseContract({
        apiVersion: 'v3.2.0',
        kind: 'DataContract',
        id: 'x',
        version: '1.0.0',
        status: 'active',
        schema: [
          {
            name,
            quality: [
              {
                type: 'sql',
                query: 'SELECT COUNT(*) FROM {object}',
                mustBe: 1,
              },
            ],
            properties: [
              { name: 'id', logicalType: 'string', description: 'id' },
            ],
          },
        ],
      }).contract;
      const [r] = await auditDatabase(c, {
        dialect: 'sqlite',
        query: async (q) =>
          db.prepare(q).all() as Array<Record<string, unknown>>,
      });
      expect(r!.quality[0]).toMatchObject({ status: 'passed', value: 1 });
    }
  });

  it('speaks SQL Server: TOP, brackets, SCHEMA_NAME()', async () => {
    const seen: string[] = [];
    const query = async (sql: string) => {
      seen.push(sql);
      if (sql.includes('information_schema.columns'))
        return [
          {
            TABLE_NAME: 't',
            COLUMN_NAME: 'a]b',
            DATA_TYPE: 'int',
            IS_NULLABLE: 'NO',
          },
        ];
      if (sql.includes('table_constraints')) return [];
      return [{ v: 0 }];
    };
    const c = parseContract({
      apiVersion: 'v3.2.0',
      kind: 'DataContract',
      id: 'x',
      version: '1.0.0',
      status: 'active',
      schema: [
        {
          name: 't',
          properties: [
            { name: 'a]b', logicalType: 'integer', description: 'x' },
          ],
        },
      ],
    }).contract;
    await auditDatabase(c, { dialect: 'mssql', query, sampleSize: 5 });
    expect(seen.some((q) => q.includes('SCHEMA_NAME()'))).toBe(true);
    // One row past sampleSize says whether the sample read every row.
    expect(seen).toContain('SELECT TOP 6 * FROM [t]');
    expect(seen.some((q) => q.includes('LIMIT'))).toBe(false);
    expect(quoteIdent('mssql', 'a]b')).toBe('[a]]b]');
    // COUNT is an int on SQL Server and overflows past 2^31 - 1 rows.
    const counts = seen.filter((q) => /COUNT/.test(q));
    expect(counts.length).toBeGreaterThan(0);
    expect(counts.filter((q) => /COUNT\(/.test(q))).toEqual([]);
    expect(counts.every((q) => q.includes('COUNT_BIG('))).toBe(true);
  });
});

describe('SLA order is instant order', () => {
  // Lexically '…T13:00:00Z' < '…T14:00:00+05:00', but the second is 09:00Z: four hours earlier.
  const offsets = () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE events (id TEXT, at TEXT);
      INSERT INTO events VALUES ('e1', '2026-11-18T13:00:00Z'), ('e2', '2026-11-18T14:00:00+05:00');
    `);
    return db;
  };
  const contract = parseContract({
    apiVersion: 'v3.2.0',
    kind: 'DataContract',
    id: 'ev',
    version: '1.0.0',
    status: 'active',
    schema: [
      {
        name: 'events',
        properties: [
          { name: 'id', logicalType: 'string', description: 'id' },
          { name: 'at', logicalType: 'timestamp', description: 'at' },
        ],
      },
    ],
    slaProperties: [
      { property: 'retention', value: 24, unit: 'h', element: 'events.at' },
    ],
  }).contract;
  const opts = (db: DatabaseSync, sampleSize?: number): DatabaseOptions => ({
    dialect: 'sqlite',
    now: () => NOW,
    sampleSize,
    query: async (sql) =>
      db.prepare(sql).all() as Array<Record<string, unknown>>,
  });

  it('agrees with batch verification on text timestamps with mixed offsets', async () => {
    const db = offsets();
    const [audit] = await auditDatabase(contract, opts(db, Infinity));
    const batch = checkRecords(
      contract,
      'events',
      db.prepare('SELECT * FROM events').all() as Array<
        Record<string, unknown>
      >,
      { lenient: true, now: () => NOW },
    );
    expect(audit!.sla[0]).toMatchObject({
      status: 'breached',
      observedMs: 27 * 3_600_000,
    });
    expect(audit!.sla[0]!.observedMs).toBe(batch.sla[0]!.observedMs);
  });

  it('an unreadable timestamp leaves retention unknown, unless a readable one already breaks it', async () => {
    const table = (rows: string) => {
      const db = new DatabaseSync(':memory:');
      db.exec(
        `CREATE TABLE events (id TEXT, at TEXT); INSERT INTO events VALUES ${rows};`,
      );
      return db;
    };
    const both = async (db: DatabaseSync, c = contract) => {
      const [audit] = await auditDatabase(c, opts(db, Infinity));
      const batch = checkRecords(
        c,
        'events',
        db.prepare('SELECT * FROM events').all() as Array<
          Record<string, unknown>
        >,
        { lenient: true, now: () => NOW },
      );
      return [audit!.sla[0]!, batch.sla[0]!];
    };
    const recent = `('e1', '2026-11-19T11:00:00Z')`;
    const old = `('e1', '2026-11-17T11:00:00Z')`;
    const junk = `('e2', 'unknown')`;
    for (const r of await both(table(`${recent}, ${junk}`)))
      expect(r).toMatchObject({
        status: 'unknown',
        error: expect.stringMatching(/could be the oldest/),
      });
    for (const r of await both(table(`${old}, ${junk}`)))
      expect(r).toMatchObject({ status: 'breached' });

    // Freshness reads the other way: a recent readable value keeps it.
    const fresh = structuredClone(contract);
    fresh.slaProperties = [
      { property: 'freshness', value: 24, unit: 'h', element: 'events.at' },
    ];
    for (const r of await both(table(`${recent}, ${junk}`), fresh))
      expect(r).toMatchObject({ status: 'kept' });
    for (const r of await both(table(`${old}, ${junk}`), fresh))
      expect(r).toMatchObject({ status: 'breached' }); // an unreadable value is no evidence of freshness
  });

  it('cannot order text over a partial sample: unknown, never kept', async () => {
    const [r] = await auditDatabase(contract, opts(offsets(), 1));
    expect(r!.sla[0]).toMatchObject({
      status: 'unknown',
      error: expect.stringMatching(/does not sort as instants/),
    });
    expect(r!.status).not.toBe('passed');
  });

  it('lets the database order a native timestamp column', async () => {
    const seen: string[] = [];
    const query = async (sql: string) => {
      seen.push(sql);
      if (sql.includes('information_schema.columns'))
        return [
          {
            table_name: 'events',
            column_name: 'id',
            data_type: 'text',
            is_nullable: 'YES',
          },
          {
            table_name: 'events',
            column_name: 'at',
            data_type: 'timestamp with time zone',
            is_nullable: 'YES',
          },
        ];
      if (sql.includes('table_constraints')) return [];
      if (sql.startsWith('SELECT MAX('))
        return [
          {
            newest: new Date('2026-11-19T11:00:00Z'),
            oldest: new Date('2026-11-18T09:00:00Z'),
          },
        ];
      if (sql.startsWith('SELECT * FROM'))
        return [
          { id: 'e1', at: new Date('2026-11-19T11:00:00Z') },
          { id: 'e2', at: new Date('2026-11-19T11:00:00Z') },
        ];
      return [{ v: 3 }];
    };
    const [r] = await auditDatabase(contract, {
      dialect: 'postgres',
      query,
      now: () => NOW,
      sampleSize: 1,
    });
    expect(seen.some((q) => q.startsWith('SELECT MAX('))).toBe(true);
    expect(r!.sla[0]).toMatchObject({
      status: 'breached',
      observedMs: 27 * 3_600_000,
    });
  });
});

describe('sample size', () => {
  it('reads every row only for Infinity; NaN, negatives and fractions are errors', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE t (a TEXT); INSERT INTO t VALUES ('x');`);
    const seen: string[] = [];
    const options = (sampleSize: number): DatabaseOptions => ({
      dialect: 'sqlite',
      sampleSize,
      query: async (sql) => {
        seen.push(sql);
        return db.prepare(sql).all() as Array<Record<string, unknown>>;
      },
    });
    for (const bad of [Number.NaN, -1, 2.5, -Infinity]) {
      await expect(sampleRows(options(bad), 't')).rejects.toThrow(RangeError);
      await expect(
        draftContractFromDatabase(options(bad), { id: 'd' }),
      ).rejects.toThrow(/sampleSize must be/);
    }
    expect(seen).toEqual([]); // rejected before any query
    expect(await sampleRows(options(Infinity), 't')).toHaveLength(1);
    expect(seen).toEqual(['SELECT * FROM "t"']);
  });
});

describe('views', () => {
  it('audits a declared view, and a draft reads tables only', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE raw_customers (id TEXT, name TEXT);
      INSERT INTO raw_customers VALUES ('c1', 'Alex'), ('c2', NULL);
      CREATE VIEW customers AS SELECT id, name FROM raw_customers;
    `);
    const options: DatabaseOptions = {
      dialect: 'sqlite',
      query: async (sql) =>
        db.prepare(sql).all() as Array<Record<string, unknown>>,
      now: () => NOW,
    };
    const c = parseContract({
      apiVersion: 'v3.2.0',
      kind: 'DataContract',
      id: 'v',
      version: '1.0.0',
      status: 'active',
      schema: [
        {
          name: 'customers',
          physicalType: 'view',
          properties: [
            { name: 'id', logicalType: 'string' },
            { name: 'name', logicalType: 'string', required: true },
          ],
        },
      ],
    }).contract;
    const [r] = await auditDatabase(c, options);
    const codes = r!.findings.map((f) => `${f.path}:${f.code}`);
    expect(codes).toContain('name:required-missing');
    expect(codes.some((x) => x.endsWith('missing-column'))).toBe(false);
    const draft = await draftContractFromDatabase(options, { id: 'd' });
    expect(draft.schema?.map((o) => o.name)).toEqual(['raw_customers']);

    // A table that became a view breaks the declared kind.
    c.schema![0]!.physicalType = 'table';
    const [moved] = await auditDatabase(c, options);
    expect(moved!.findings.find((f) => f.path === '$')).toMatchObject({
      code: 'physical-type-drift',
      severity: 'error',
      expected: 'table',
    });
    expect(moved!.status).toBe('failed');
    // No declared kind, no promise about it.
    delete c.schema![0]!.physicalType;
    const [free] = await auditDatabase(c, options);
    expect(free!.findings.some((f) => f.path === '$')).toBe(false);
  });
});

describe('uniqueness over the whole table', () => {
  it('counts duplicate keys beyond the sample, and composite keys as tuples', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE t (a TEXT, b TEXT, u TEXT);
      INSERT INTO t VALUES ('1','x','p'), ('1','y','q'), ('2','x', NULL), ('2','x', NULL);`);
    const c = parseContract({
      apiVersion: 'v3.2.0',
      kind: 'DataContract',
      id: 'x',
      version: '1.0.0',
      status: 'active',
      schema: [
        {
          name: 't',
          properties: [
            {
              name: 'a',
              logicalType: 'string',
              primaryKey: true,
              primaryKeyPosition: 1,
              description: 'a',
            },
            {
              name: 'b',
              logicalType: 'string',
              primaryKey: true,
              primaryKeyPosition: 2,
              description: 'b',
            },
            {
              name: 'u',
              logicalType: 'string',
              unique: true,
              description: 'u',
            },
          ],
        },
      ],
    }).contract;
    const [r] = await auditDatabase(c, {
      dialect: 'sqlite',
      sampleSize: 1,
      query: async (q) => db.prepare(q).all() as Array<Record<string, unknown>>,
    });
    // (2,x) repeats once; ('1',*) is not a duplicate as a tuple; NULLs in u are not compared.
    expect(r!.findings.filter((f) => f.code === 'duplicate-key')).toEqual([
      expect.objectContaining({ path: 'a,b', count: 1, severity: 'error' }),
    ]);
    expect(r!.status).toBe('failed');
  });
});

describe('compound duplicateValues over a table', () => {
  it('runs as one GROUP BY over the named columns', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(
      `CREATE TABLE orders (tenant_id TEXT, order_id TEXT); INSERT INTO orders VALUES ('a','1'), ('b','1'), ('a','1'), ('a','1');`,
    );
    const c = parseContract({
      apiVersion: 'v3.2.0',
      kind: 'DataContract',
      id: 'orders',
      version: '1.0.0',
      status: 'active',
      schema: [
        {
          name: 'orders',
          quality: [
            {
              metric: 'duplicateValues',
              mustBeLessOrEqualTo: 1,
              arguments: { properties: ['tenant_id', 'order_id'] },
            },
          ],
          properties: [
            { name: 'tenant_id', logicalType: 'string', description: 't' },
            { name: 'order_id', logicalType: 'string', description: 'o' },
          ],
        },
      ],
    }).contract;
    const [r] = await auditDatabase(c, {
      dialect: 'sqlite',
      sampleSize: 1,
      query: async (q) => db.prepare(q).all() as Array<Record<string, unknown>>,
    });
    expect(r!.quality[0]).toMatchObject({ status: 'failed', value: 2 });
  });
});

describe('physical types keep their length and precision', () => {
  it('reads length and precision from information_schema and compares them', async () => {
    const query = async (sql: string) => {
      if (sql.includes('information_schema.columns'))
        return [
          {
            table_name: 't',
            column_name: 'name',
            data_type: 'character varying',
            is_nullable: 'YES',
            character_maximum_length: 100,
            numeric_precision: null,
            numeric_scale: null,
          },
          {
            table_name: 't',
            column_name: 'code',
            data_type: 'character varying',
            is_nullable: 'YES',
            character_maximum_length: 10,
            numeric_precision: null,
            numeric_scale: null,
          },
          {
            table_name: 't',
            column_name: 'amount',
            data_type: 'numeric',
            is_nullable: 'YES',
            character_maximum_length: null,
            numeric_precision: 10,
            numeric_scale: 2,
          },
          {
            table_name: 't',
            column_name: 'n',
            data_type: 'integer',
            is_nullable: 'YES',
            character_maximum_length: null,
            numeric_precision: 32,
            numeric_scale: 0,
          },
        ];
      if (sql.includes('table_constraints')) return [];
      return [{ v: 0 }];
    };
    const [t] = await introspect({ dialect: 'postgres', query });
    expect(t!.columns.map((c) => c.dataType)).toEqual([
      'character varying(100)',
      'character varying(10)',
      'numeric(10,2)',
      'integer',
    ]);
    const c = parseContract({
      apiVersion: 'v3.2.0',
      kind: 'DataContract',
      id: 'x',
      version: '1.0.0',
      status: 'active',
      schema: [
        {
          name: 't',
          properties: [
            {
              name: 'name',
              logicalType: 'string',
              physicalType: 'VARCHAR(100)',
              description: 'n',
            },
            {
              name: 'code',
              logicalType: 'string',
              physicalType: 'VARCHAR(100)',
              description: 'c',
            },
            {
              name: 'amount',
              logicalType: 'number',
              physicalType: 'DECIMAL(10,2)',
              description: 'a',
            },
            {
              name: 'n',
              logicalType: 'integer',
              physicalType: 'INT4',
              description: 'n',
            },
          ],
        },
      ],
    }).contract;
    const [r] = await auditDatabase(c, {
      dialect: 'postgres',
      query,
      sampleSize: 0,
    });
    expect(
      r!.findings
        .filter((f) => f.code === 'physical-type-drift')
        .map((f) => f.path),
    ).toEqual(['code']);
  });

  it.each([
    ['VARCHAR(100)', 'character varying(100)', true],
    ['VARCHAR', 'varchar(255)', true],
    ['VARCHAR(100)', 'text', false],
    ['NUMERIC(10, 2)', 'decimal(10,2)', true],
    ['TIMESTAMP', 'timestamp without time zone', true],
    ['TIMESTAMP', 'timestamp with time zone', false],
    ['INT UNSIGNED', 'int unsigned', true],
  ])('%s vs %s → %s', (declared, actual, same) =>
    expect(samePhysicalType(declared, actual)).toBe(same),
  );
});

describe('per-record promises over the whole table', () => {
  const table = (rows: string) => {
    const db = new DatabaseSync(':memory:');
    db.exec(
      `CREATE TABLE t (id TEXT, status TEXT, qty INTEGER, code TEXT); INSERT INTO t VALUES ${rows};`,
    );
    return {
      dialect: 'sqlite' as const,
      now: () => NOW,
      query: async (q: string) =>
        db.prepare(q).all() as Array<Record<string, unknown>>,
    };
  };
  const contractWith = (props: unknown[]) =>
    parseContract({
      apiVersion: 'v3.2.0',
      kind: 'DataContract',
      id: 'x',
      version: '1.0.0',
      status: 'active',
      schema: [{ name: 't', properties: props }],
    }).contract;
  const plain = [
    { name: 'id', logicalType: 'string', primaryKey: true, description: 'id' },
    {
      name: 'status',
      logicalType: 'string',
      enum: [{ value: 'on' }],
      description: 's',
    },
    {
      name: 'qty',
      logicalType: 'integer',
      logicalTypeOptions: { minimum: 0 },
      description: 'q',
    },
    { name: 'code', logicalType: 'string', description: 'c' },
  ];

  it('finds a null primary key, a bad enum value and an out-of-range number outside the sample', async () => {
    const db = table(`('a','on',1,'x'), (NULL,'off',-5,'y')`);
    const [r] = await auditDatabase(contractWith(plain), {
      ...db,
      sampleSize: 1,
    });
    const errors = r!.findings
      .filter((f) => f.severity === 'error')
      .map((f) => `${f.path}:${f.code}:${f.count}`)
      .toSorted();
    expect(errors).toEqual([
      'id:required-missing:1',
      'qty:below-minimum:1',
      'status:invalid-value:1',
    ]);
    expect(r!.status).toBe('failed');
  });

  it('is incomplete when a sample-only promise was not checked on every row', async () => {
    const withPattern = contractWith([
      ...plain.slice(0, 3),
      {
        name: 'code',
        logicalType: 'string',
        logicalTypeOptions: { pattern: '^x$' },
        description: 'c',
      },
    ]);
    const db = table(`('a','on',1,'x'), ('b','on',2,'nope')`);
    const [partial] = await auditDatabase(withPattern, {
      ...db,
      sampleSize: 1,
    });
    expect(partial!.status).toBe('incomplete');
    expect(partial!.unchecked).toEqual([
      expect.stringMatching(/read 1 of 2 rows; checked only there: code/),
    ]);
    const [all] = await auditDatabase(withPattern, {
      ...db,
      sampleSize: Infinity,
    });
    expect(
      all!.findings.find((f) => f.code === 'pattern-mismatch'),
    ).toMatchObject({ path: 'code', count: 1 });
    expect(all!.unchecked).toEqual([]);
  });

  it('passes a clean table on a partial sample when every promise has a full-table check', async () => {
    const db = table(`('a','on',1,'x'), ('b','on',2,'y')`);
    const [r] = await auditDatabase(contractWith(plain), {
      ...db,
      sampleSize: 1,
    });
    expect(r!.status).toBe('passed');
  });
});

describe('a SQL result proves a pass only when it means what the runtime means', () => {
  const sqlite = (ddl: string) => {
    const db = new DatabaseSync(':memory:');
    db.exec(ddl);
    return {
      dialect: 'sqlite' as const,
      now: () => NOW,
      query: async (q: string) =>
        db.prepare(q).all() as Array<Record<string, unknown>>,
    };
  };
  const one = (prop: Record<string, unknown>) =>
    parseContract({
      apiVersion: 'v3.2.0',
      kind: 'DataContract',
      id: 'x',
      version: '1.0.0',
      status: 'active',
      schema: [
        { name: 't', properties: [{ name: 'v', description: 'v', ...prop }] },
      ],
    }).contract;

  it('does not take a SQLite INTEGER column as proof of integer values', async () => {
    const db = sqlite(
      `CREATE TABLE t (v INTEGER); INSERT INTO t VALUES (1), ('bad');`,
    );
    const c = one({
      logicalType: 'integer',
      logicalTypeOptions: { minimum: 0 },
    });
    const [partial] = await auditDatabase(c, { ...db, sampleSize: 1 });
    expect(partial!.status).toBe('incomplete');
    expect(partial!.unchecked).toEqual([
      expect.stringMatching(/checked only there: v/),
    ]);
    const [all] = await auditDatabase(c, { ...db, sampleSize: Infinity });
    expect(all!.findings.find((f) => f.code === 'type-mismatch')).toMatchObject(
      { count: 1 },
    );
    expect(all!.status).toBe('failed');
  });

  it('compares case-sensitively under a NOCASE column, as the runtime does', async () => {
    const db = sqlite(
      `CREATE TABLE t (v TEXT COLLATE NOCASE); INSERT INTO t VALUES ('active'), ('ACTIVE');`,
    );
    const [r] = await auditDatabase(
      one({ logicalType: 'string', enum: [{ value: 'active' }] }),
      { ...db, sampleSize: 1 },
    );
    expect(r!.findings.find((f) => f.code === 'invalid-value')).toMatchObject({
      count: 1,
    });
    expect(r!.status).toBe('failed');
  });

  it('keeps what the sample saw when the database counts fewer', async () => {
    const c = one({ logicalType: 'string', enum: [{ value: 'active' }] });
    const query = async (sql: string) => {
      if (sql.includes('information_schema.columns'))
        return [
          {
            table_name: 't',
            column_name: 'v',
            data_type: 'text',
            is_nullable: 'YES',
          },
        ];
      if (sql.includes('table_constraints')) return [];
      if (sql.startsWith('SELECT * FROM')) return [{ v: 'ACTIVE' }];
      return [{ v: sql.includes('COUNT(*) AS v FROM "t" WHERE') ? 0 : 1 }];
    };
    const [r] = await auditDatabase(c, {
      dialect: 'postgres',
      query,
      sampleSize: 1,
    });
    expect(r!.findings.find((f) => f.code === 'invalid-value')).toMatchObject({
      count: 1,
    });
    expect(r!.unchecked).toEqual([
      expect.stringMatching(/database counted 0, the sample 1/),
    ]);
    expect(r!.status).toBe('failed');
  });

  it('leaves string comparisons to the sample where the dialect cannot make them exact', async () => {
    const seen: string[] = [];
    const query = async (sql: string) => {
      seen.push(sql);
      if (sql.includes('information_schema.columns'))
        return [
          {
            TABLE_NAME: 't',
            COLUMN_NAME: 'v',
            DATA_TYPE: 'varchar',
            IS_NULLABLE: 'YES',
            CHARACTER_MAXIMUM_LENGTH: 10,
          },
        ];
      if (sql.includes('table_constraints')) return [];
      if (sql.startsWith('SELECT TOP')) return [{ v: 'active' }];
      return [{ v: sql.includes('COUNT_BIG(*) AS v FROM [t]') ? 2 : 0 }];
    };
    const [r] = await auditDatabase(
      one({ logicalType: 'string', enum: [{ value: 'active' }] }),
      { dialect: 'mssql', query, sampleSize: 1 },
    );
    expect(seen.some((q) => q.includes('NOT IN'))).toBe(false);
    expect(r!.status).toBe('incomplete');
  });
});

describe('aggregate SQL compares as the runtime does', () => {
  const sqlite = (ddl: string) => {
    const db = new DatabaseSync(':memory:');
    db.exec(ddl);
    return {
      dialect: 'sqlite' as const,
      now: () => NOW,
      query: async (q: string) =>
        db.prepare(q).all() as Array<Record<string, unknown>>,
    };
  };
  const withRules = (quality: unknown[], extra: Record<string, unknown> = {}) =>
    parseContract({
      apiVersion: 'v3.2.0',
      kind: 'DataContract',
      id: 'x',
      version: '1.0.0',
      status: 'active',
      schema: [
        {
          name: 't',
          properties: [
            {
              name: 'v',
              logicalType: 'string',
              description: 'v',
              quality,
              ...extra,
            },
          ],
        },
      ],
    }).contract;

  it('counts invalid, missing and duplicate values case-sensitively under a NOCASE column', async () => {
    const db = sqlite(
      `CREATE TABLE t (v TEXT COLLATE NOCASE); INSERT INTO t VALUES ('ACTIVE'), ('ACTIVE'), ('a'), ('A');`,
    );
    const c = withRules([
      {
        metric: 'invalidValues',
        arguments: { validValues: ['active', 'a', 'A'] },
        mustBeLessThan: 2,
      },
      {
        metric: 'missingValues',
        arguments: { missingValues: ['n/a'] },
        mustBe: 0,
      },
      { metric: 'duplicateValues', mustBeLessOrEqualTo: 1 },
    ]);
    const batch = checkRecords(c, 't', [
      { v: 'ACTIVE' },
      { v: 'ACTIVE' },
      { v: 'a' },
      { v: 'A' },
    ]);
    const [audit] = await auditDatabase(c, { ...db, sampleSize: 1 });
    const values = (r: {
      quality: Array<{ metric: string; value?: number; status: string }>;
    }) => r.quality.map((q) => `${q.metric}:${q.status}:${q.value}`);
    expect(values(audit!)).toEqual(values(batch));
    expect(values(audit!)).toEqual([
      'invalidValues:failed:2',
      'missingValues:passed:0',
      'duplicateValues:passed:1',
    ]);
  });

  it('groups a unique key case-sensitively too', async () => {
    const db = sqlite(
      `CREATE TABLE t (v TEXT COLLATE NOCASE); INSERT INTO t VALUES ('a'), ('A');`,
    );
    const [r] = await auditDatabase(withRules([], { unique: true }), {
      ...db,
      sampleSize: 1,
    });
    expect(r!.findings.filter((f) => f.code === 'duplicate-key')).toEqual([]);
  });

  it('falls back to the sample where the dialect has no exact comparison', async () => {
    const seen: string[] = [];
    const query = async (sql: string) => {
      seen.push(sql);
      if (sql.includes('information_schema.columns'))
        return [
          {
            TABLE_NAME: 't',
            COLUMN_NAME: 'v',
            DATA_TYPE: 'varchar',
            IS_NULLABLE: 'YES',
            CHARACTER_MAXIMUM_LENGTH: 10,
          },
        ];
      if (sql.includes('table_constraints')) return [];
      if (sql.startsWith('SELECT TOP'))
        return [{ v: 'ACTIVE' }, { v: 'ACTIVE' }];
      if (
        sql.startsWith('SELECT COUNT(*) AS v FROM [t]') &&
        !sql.includes('WHERE')
      )
        return [{ v: 2 }];
      return [{ v: 0 }];
    };
    const [r] = await auditDatabase(
      withRules([
        {
          metric: 'invalidValues',
          arguments: { validValues: ['active'] },
          mustBeLessThan: 2,
        },
      ]),
      { dialect: 'mssql', query, sampleSize: 10 },
    );
    expect(seen.some((q) => q.includes('NOT IN'))).toBe(false);
    expect(r!.quality[0]).toMatchObject({ status: 'failed', value: 2 }); // the whole-table sample decides
  });
});

describe('Postgres text types', () => {
  it('casts citext and ICU-collated text to text before COLLATE "C", and leaves CHAR(n) and enum types to the sample', async () => {
    const seen: string[] = [];
    const query = async (sql: string) => {
      seen.push(sql);
      if (sql.includes('information_schema.columns'))
        return [
          {
            table_name: 't',
            column_name: 's',
            data_type: 'USER-DEFINED',
            udt_name: 'citext',
            is_nullable: 'YES',
          },
          {
            table_name: 't',
            column_name: 'v',
            data_type: 'character varying',
            udt_name: 'varchar',
            is_nullable: 'YES',
            character_maximum_length: 20,
          },
          {
            table_name: 't',
            column_name: 'c',
            data_type: 'character',
            udt_name: 'bpchar',
            is_nullable: 'YES',
            character_maximum_length: 8,
          },
          {
            table_name: 't',
            column_name: 'm',
            data_type: 'USER-DEFINED',
            udt_name: 'mood',
            is_nullable: 'YES',
          },
        ];
      if (sql.includes('table_constraints')) return [];
      return [{ v: 0 }];
    };
    const prop = (name: string) => ({
      name,
      logicalType: 'string',
      description: name,
      enum: [{ value: 'active' }],
    });
    const c = parseContract({
      apiVersion: 'v3.2.0',
      kind: 'DataContract',
      id: 'x',
      version: '1.0.0',
      status: 'active',
      schema: [
        { name: 't', properties: ['s', 'v', 'c', 'm'].map((n) => prop(n)) },
      ],
    }).contract;
    const [r] = await auditDatabase(c, {
      dialect: 'postgres',
      query,
      sampleSize: 0,
    });
    const operands = seen
      .filter((q) => q.includes('NOT IN'))
      .map((q) => /AND \((.*?) NOT IN/.exec(q)?.[1]);
    expect(operands).toEqual([
      '"s"::text COLLATE "C"',
      '"v"::text COLLATE "C"',
    ]);
    expect(r!.unchecked).toEqual([
      expect.stringMatching(/checked only there: c, m/),
    ]);
    const [catalog] = await introspect({ dialect: 'postgres', query });
    expect(catalog!.columns.map((col) => col.dataType)).toEqual([
      'citext',
      'character varying(20)',
      'character(8)',
      'mood',
    ]);
  });
});
