/**
 * Consumer-driven contracts, semantic links, verified statements, the
 * tolerant-reader query and the file-name convention: the parts of the
 * "Data Contracts" article beyond verifying data.
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { lintContract, parseContract, type DataContract } from './contract.js';
import { diffContracts, formatSatisfaction, satisfies } from './diff.js';
import {
  auditDatabase,
  CONTEXT_OBJECT,
  tolerantSelect,
  type DatabaseOptions,
} from './db.js';
import { formatReport } from './format.js';
import { customersYaml } from './__fixtures__/index.js';

const provider = () => structuredClone(parseContract(customersYaml).contract);
const expect_ = (rest: Partial<DataContract>): DataContract => ({
  apiVersion: 'v3.2.0',
  kind: 'DataContract',
  id: 'cross-sell-model-needs',
  version: '1.0.0',
  status: 'active',
  ...rest,
});

describe('satisfies: consumer-driven contracts', () => {
  it('is met by a provider promising at least what is expected', () => {
    const r = satisfies(
      provider(),
      expect_({
        schema: [
          {
            name: 'customers',
            properties: [
              { name: 'customer_id', logicalType: 'string' },
              { name: 'customer_name', required: true },
              // No type stated: none expected.
              { name: 'annual_premium', logicalTypeOptions: { minimum: 0 } },
            ],
          },
        ],
        // The provider promises 24 hours; 48 is weaker, so met.
        slaProperties: [
          {
            property: 'freshness',
            value: 2,
            unit: 'day',
            element: 'customers.last_updated_at',
          },
        ],
      }),
    );
    expect(r).toMatchObject({ ok: true, unmet: [] });
    expect(formatSatisfaction(r)).toBe(
      'The provider promises everything expected.',
    );
  });

  it('names every expectation the provider lacks or weakens', () => {
    const r = satisfies(
      provider(),
      expect_({
        schema: [
          {
            name: 'customers',
            properties: [
              { name: 'customer_id', logicalType: 'integer' },
              { name: 'email', logicalType: 'string' },
              { name: 'customer_status', required: true },
              { name: 'annual_premium', logicalTypeOptions: { minimum: 100 } },
            ],
          },
          { name: 'policies' },
        ],
        slaProperties: [
          {
            property: 'freshness',
            value: 1,
            unit: 'hour',
            element: 'customers.last_updated_at',
          },
        ],
        servers: [{ server: 'production', type: 'snowflake' }],
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.unmet.map((c) => `${c.path}: ${c.message}`)).toEqual(
      expect.arrayContaining([
        'customers.customer_id: logicalType integer → string',
        'customers.email: the provider offers no such property',
        'customers.customer_status: no longer required: consumers may now get nulls',
        'customers.annual_premium.minimum: 100 → 0',
        'policies: the provider offers no such object',
        'sla.freshness:customers.last_updated_at: 1 hour → 24 hours',
        'servers.production: the provider has no such server',
      ]),
    );
    expect(formatSatisfaction(r)).toContain('7 expectations not met.');
  });

  it('expects valid values by subset: the provider may allow fewer, never more', () => {
    const rule = (validValues: string[]) => ({
      name: 'customers',
      properties: [
        {
          name: 'customer_status',
          quality: [
            {
              type: 'library',
              metric: 'invalidValues',
              arguments: { validValues },
              mustBe: 0,
            },
          ],
        },
      ],
    });
    // The consumer handles four statuses; the provider sends three of them.
    expect(
      satisfies(
        provider(),
        expect_({
          schema: [rule(['active', 'lapsed', 'cancelled', 'frozen'])],
        }),
      ).ok,
    ).toBe(true);
    // The consumer handles two; the provider may send a third.
    expect(
      satisfies(provider(), expect_({ schema: [rule(['active', 'lapsed'])] }))
        .ok,
    ).toBe(false);
  });

  it('reads an expected SLA on its own default element, not the provider’s', () => {
    const p = provider();
    p.slaDefaultElement = 'customers.customer_id';
    const r = satisfies(
      p,
      expect_({
        slaDefaultElement: 'customers.last_updated_at',
        slaProperties: [{ property: 'freshness', value: 48, unit: 'hours' }],
      }),
    );
    expect(r.ok).toBe(true);
  });

  it('expects a server by what it states: a partial entry is not a changed one', () => {
    const p = provider();
    p.servers = [
      {
        server: 'production',
        type: 'snowflake',
        account: 'acme',
        database: 'prod',
      },
    ];
    expect(
      satisfies(
        p,
        expect_({ servers: [{ server: 'production', type: 'snowflake' }] }),
      ).ok,
    ).toBe(true);
    expect(
      satisfies(
        p,
        expect_({ servers: [{ server: 'production', type: 'postgres' }] }),
      ).ok,
    ).toBe(false);
  });
});

describe('semantic links', () => {
  const link = (url: string, type = 'semantics') => [{ type, url }];
  const withLink = (defs?: unknown) => {
    const c = provider();
    c.schema![0]!.properties![0]!.authoritativeDefinitions = defs as never;
    return c;
  };
  const changes = (a: DataContract, b: DataContract) =>
    diffContracts(a, b).changes.map(
      (c) => `${c.level}${c.review ? ' review' : ''} ${c.message}`,
    );

  it('breaks when a column now means another concept, or no stated one', () => {
    const before = withLink(link('https://example.com/ns/Customer.id'));
    expect(
      changes(before, withLink(link('https://example.com/ns/Account.id'))),
    ).toEqual([
      'breaking concept https://example.com/ns/Customer.id → https://example.com/ns/Account.id',
    ]);
    expect(changes(before, withLink(undefined))).toEqual([
      'breaking concept link removed: https://example.com/ns/Customer.id',
    ]);
  });

  it('adds meaning when a concept is linked where none was', () => {
    expect(
      changes(
        withLink(undefined),
        withLink(link('https://example.com/ns/Customer.id')),
      ),
    ).toEqual(['additive concept linked: https://example.com/ns/Customer.id']);
  });

  it('leaves other links (policies, docs) to a person', () => {
    expect(
      changes(
        withLink(link('https://a/policy', 'businessDefinition')),
        withLink(link('https://b/policy', 'businessDefinition')),
      ),
    ).toEqual(['patch review authoritativeDefinitions changed']);
  });

  it('checks a consumer’s expected concept: a join key must mean the same thing', () => {
    const p = withLink(link('https://example.com/ns/Customer.id'));
    const wants = (url: string) =>
      expect_({
        schema: [
          {
            name: 'customers',
            properties: [
              {
                name: 'customer_id',
                authoritativeDefinitions: link(url) as never,
              },
            ],
          },
        ],
      });
    expect(satisfies(p, wants('https://example.com/ns/Customer.id')).ok).toBe(
      true,
    );
    expect(satisfies(p, wants('https://example.com/ns/Party.id')).ok).toBe(
      false,
    );
  });
});

function db(): DatabaseOptions {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE customers (customer_id TEXT PRIMARY KEY, customer_name TEXT NOT NULL,
      annual_premium INTEGER NOT NULL, customer_status TEXT, last_updated_at TEXT);
    INSERT INTO customers VALUES
      ('c1', 'Alex Doe', 120000, 'active', '2026-11-19T10:00:00Z'),
      ('c2', 'Sam Roe', 90000, 'lapsed', '2026-11-19T11:00:00Z'),
      ('c3', 'Kim Poe', 50000, 'active', '2026-11-19T11:30:00Z');
  `);
  return {
    dialect: 'sqlite',
    query: async (sql) =>
      sqlite.prepare(sql).all() as Array<Record<string, unknown>>,
    now: () => Date.parse('2026-11-19T12:00:00Z'),
  };
}

describe('verified statements', () => {
  const withStatements = (...answers: string[]) => {
    const c = provider();
    c.context = {
      verifiedStatements: answers.map((answer, i) => ({
        question: `q${i}`,
        answer,
      })),
    };
    return c;
  };

  it('passes while every answer still runs', async () => {
    const reports = await auditDatabase(
      withStatements(
        "SELECT COUNT(*) FROM customers WHERE customer_status = 'active'",
      ),
      db(),
    );
    const context = reports.find((r) => r.object === CONTEXT_OBJECT)!;
    expect(context.status).toBe('passed');
    expect(context.quality[0]).toMatchObject({
      metric: 'verifiedStatements[0]',
      status: 'passed',
    });
  });

  it('fails the audit when an answer agents reuse no longer runs', async () => {
    const errors: string[] = [];
    const reports = await auditDatabase(
      withStatements(
        'SELECT COUNT(*) FROM customers',
        'SELECT premium FROM customers',
      ),
      { ...db(), onQueryError: (_e, sql) => errors.push(sql) },
    );
    const context = reports.find((r) => r.object === CONTEXT_OBJECT)!;
    expect(context.status).toBe('failed');
    expect(context.quality.map((q) => q.status)).toEqual(['passed', 'failed']);
    expect(context.quality[1]!.error).toBe(
      'the answer no longer runs: query failed (ERR_SQLITE_ERROR)',
    );
    expect(errors).toEqual(['SELECT premium FROM customers']);
    expect(formatReport(context)).toContain('✖ q1: the answer no longer runs');
  });

  it('leaves the audit incomplete for a statement with no answer, and lints it', async () => {
    const c = provider();
    c.context = { verifiedStatements: [{ question: 'How many?' }] };
    const reports = await auditDatabase(c, db());
    expect(reports.find((r) => r.object === CONTEXT_OBJECT)!.status).toBe(
      'incomplete',
    );
    expect(lintContract(c).map((i) => i.code)).toContain(
      'unmeasurable-statement',
    );
  });

  it('runs no statements when auditing chosen tables, and adds no report without any', async () => {
    const reports = await auditDatabase(withStatements('SELECT broken'), {
      ...db(),
      tables: ['customers'],
    });
    expect(reports.map((r) => r.object)).toEqual(['customers']);
    const plain = await auditDatabase(provider(), db());
    expect(plain.map((r) => r.object)).toEqual(['customers']);
  });
});

describe('tolerantSelect', () => {
  it('names the columns, never *, and reads physical names under contract names', () => {
    const c = provider();
    c.schema![0]!.physicalName = 'tbl_cust';
    c.schema![0]!.properties![1]!.physicalName = 'cust_nm';
    expect(
      tolerantSelect(c, 'customers', { dialect: 'postgres', schema: 'dp' }, [
        'customer_id',
        'customer_name',
      ]),
    ).toBe(
      'SELECT "customer_id", "cust_nm" AS "customer_name" FROM "dp"."tbl_cust"',
    );
    expect(
      tolerantSelect(c, 'customers', { dialect: 'mssql' }, ['customer_id']),
    ).toBe('SELECT [customer_id] FROM [tbl_cust]');
  });

  it('runs against the database, and refuses a column the contract does not promise', async () => {
    const d = db();
    const rows = await d.query(tolerantSelect(provider(), 'customers', d));
    expect(Object.keys(rows[0]!)).toEqual([
      'customer_id',
      'customer_name',
      'annual_premium',
      'customer_status',
      'last_updated_at',
    ]);
    expect(() =>
      tolerantSelect(provider(), 'customers', d, ['legacy_flag']),
    ).toThrow('customers promises no property legacy_flag');
    expect(() => tolerantSelect(provider(), 'nope', d)).toThrow(
      'no schema object nope',
    );
  });
});

describe('file-name convention', () => {
  const codes = (file: string, version = '1.0.0') =>
    lintContract({ ...provider(), version }, file)
      .map((i) => i.code)
      .filter((c) => c.startsWith('file-name'));
  it('checks <id>_v<major>.odcs.yaml against the id and the major version', () => {
    expect(codes('datacontracts/customers_v1.odcs.yaml')).toEqual([]);
    expect(codes('datacontracts/customers_v1.odcs.yaml', '2.0.0')).toEqual([
      'file-name-version',
    ]);
    expect(codes(String.raw`dc\clients_v1.odcs.yml`)).toEqual(['file-name-id']);
  });
  it('says nothing of a file outside the convention', () => {
    expect(codes('contract.yaml', '2.0.0')).toEqual([]);
  });
});
