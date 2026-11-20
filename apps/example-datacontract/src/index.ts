#!/usr/bin/env node
/**
 * "Data Contracts" (Harrer & Wider, martinfowler.com) run end to end with
 * autotel-datacontract, against a SQLite stand-in for the warehouse:
 *
 *   1. Lint           the contract is valid ODCS, and named <id>_v<major>
 *   2. Data-first     draft a contract from a legacy table as it is
 *   3. Nightly test   audit the table; a broken promise fails, a fixed one passes
 *   4. For agents     the AI context's verified statements still run
 *   5. CI gate        a rename under a minor bump fails the pull request
 *   6. Consumers      the cross-sell model's own expectations, checked
 *   7. Quarantine     bad records are held back before consumers see them
 *   8. Tolerant read  the query a consumer runs, never SELECT *
 *   9. Track record   "freshness kept on 29 of the last 30 days", from metrics
 *
 * Every step asserts what it shows, so `pnpm test` fails if a claim stops holding.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { init, shutdown } from 'autotel';
import {
  diffContracts,
  formatDiff,
  formatReport,
  formatSatisfaction,
  lintContract,
  parseContract,
  redactionKeyPatterns,
  satisfies,
} from 'autotel-datacontract';
import {
  auditDatabase,
  CONTEXT_OBJECT,
  draftContractFromDatabase,
  tolerantSelect,
  type DatabaseOptions,
} from 'autotel-datacontract/db';
import {
  ContractViolationError,
  createContractGuard,
  recordReports,
} from 'autotel-datacontract/runtime';

const CONTRACT_FILE = new URL(
  '../datacontracts/customers_v1.odcs.yaml',
  import.meta.url,
);
const EXPECTATION_FILE = new URL(
  '../expectations/cross-sell.odcs.yaml',
  import.meta.url,
);
const text = readFileSync(CONTRACT_FILE, 'utf8');
const { contract } = parseContract(text);
const expectation = parseContract(
  readFileSync(EXPECTATION_FILE, 'utf8'),
).contract;

const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
const reader = new PeriodicExportingMetricReader({
  exporter,
  exportIntervalMillis: 3_600_000,
});
init({
  service: 'customers-data-product',
  metricReaders: [reader],
  // Restricted and pii:true columns never reach span attributes.
  attributeRedactor: { keyPatterns: redactionKeyPatterns(contract) },
});

const step = (title: string) => console.log(`\n━━ ${title}`);
const DAY = 86_400_000;
const MORNING = Date.parse('2026-11-19T06:00:00Z');

function warehouse(now: () => number): {
  db: DatabaseSync;
  options: DatabaseOptions;
} {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE customers (
      customer_id TEXT PRIMARY KEY,
      customer_name VARCHAR(100) NOT NULL,
      annual_premium INTEGER NOT NULL,
      customer_status TEXT,
      last_updated_at TIMESTAMP
    );
  `);
  return {
    db,
    options: {
      dialect: 'sqlite',
      query: async (sql) =>
        db.prepare(sql).all() as Array<Record<string, unknown>>,
      now,
    },
  };
}

const at = (ms: number) => new Date(ms).toISOString();

// ── 1. Lint ────────────────────────────────────────────────────────────────
step('1. Lint: valid ODCS, file named <id>_v<major>.odcs.yaml');
const issues = lintContract(contract, 'datacontracts/customers_v1.odcs.yaml');
assert.deepEqual(issues, []);
assert.ok(
  lintContract(contract, 'datacontracts/customers_v2.odcs.yaml').some(
    (i) => i.code === 'file-name-version',
  ),
);
console.log('ok, and customers_v2.odcs.yaml for a 1.0.0 contract is flagged');

// ── 2. Data-first ──────────────────────────────────────────────────────────
step('2. Data-first: draft a contract from the table as it is');
const legacy = warehouse(() => MORNING);
legacy.db.exec(`
  INSERT INTO customers VALUES
    ('c1', 'Alex Doe', 120000, 'active', '${at(MORNING - 3_600_000)}'),
    ('c2', 'Sam Roe', 90000, 'lapsed', '${at(MORNING - 7_200_000)}'),
    ('c3', 'Kim Poe', 50000, 'active', '${at(MORNING - 9_000_000)}');
`);
const draft = await draftContractFromDatabase(legacy.options, {
  id: 'customers',
});
const drafted = draft.schema?.[0];
assert.equal(draft.status, 'draft');
assert.deepEqual(
  drafted?.properties?.map((p) => `${p.name}:${p.logicalType}`),
  [
    'customer_id:string',
    'customer_name:string',
    'annual_premium:integer',
    'customer_status:string',
    'last_updated_at:timestamp',
  ],
);
console.log(
  `draft ${draft.id}@${draft.version}: ${drafted?.properties?.length} columns, types from the catalog; enrich it, then the data follows the contract`,
);

// ── 3. Nightly test ────────────────────────────────────────────────────────
step('3. Nightly test: audit production against the contract');
legacy.db.exec(
  `INSERT INTO customers VALUES ('c4', 'Lee Moe', 70000, 'frozen', '${at(MORNING - 600_000)}')`,
);
let reports = await auditDatabase(contract, legacy.options);
const table = reports.find((r) => r.object === 'customers')!;
assert.equal(table.status, 'failed');
assert.ok(
  table.quality.some(
    (q) => q.metric === 'invalidValues' && q.status === 'failed',
  ),
);
console.log(formatReport(table));
legacy.db.exec(
  `UPDATE customers SET customer_status = 'cancelled' WHERE customer_id = 'c4'`,
);
reports = await auditDatabase(contract, legacy.options);
assert.ok(reports.every((r) => r.status === 'passed'));
console.log('after the fix: every promise kept');

// ── 4. For agents ──────────────────────────────────────────────────────────
step('4. For agents: the verified statements still run');
const context = reports.find((r) => r.object === CONTEXT_OBJECT)!;
assert.equal(context.status, 'passed');
legacy.db.exec('ALTER TABLE customers RENAME COLUMN customer_status TO status');
const renamed = await auditDatabase(contract, legacy.options);
const broken = renamed.find((r) => r.object === CONTEXT_OBJECT)!;
assert.equal(broken.status, 'failed');
console.log(formatReport(broken));
legacy.db.exec('ALTER TABLE customers RENAME COLUMN status TO customer_status');

// ── 5. CI gate ─────────────────────────────────────────────────────────────
step('5. CI gate: a rename under a minor bump fails the pull request');
const proposed = structuredClone(contract);
proposed.version = '1.1.0';
proposed.schema![0]!.properties![1]!.name = 'full_name';
const diff = diffContracts(contract, proposed);
assert.equal(diff.ok, false);
assert.equal(diff.required, 'major');
console.log(formatDiff(diff));

// ── 6. Consumers ───────────────────────────────────────────────────────────
step('6. Consumer-driven: the cross-sell model’s expectations');
const met = satisfies(contract, expectation);
assert.equal(met.ok, true);
console.log(formatSatisfaction(met));
const looser = structuredClone(contract);
looser.slaProperties![1]!.value = 72; // freshness 24h → 72h
looser.schema![0]!.properties![3]!.quality![0]!.arguments = {
  validValues: ['active', 'lapsed', 'cancelled', 'suspended'],
};
const unmet = satisfies(looser, expectation);
assert.equal(unmet.unmet.length, 2);
console.log('if the provider loosened freshness and added a status:');
console.log(formatSatisfaction(unmet));

// ── 7. Quarantine ──────────────────────────────────────────────────────────
step('7. Quarantine: hold bad records back before consumers see them');
const guard = createContractGuard(contract, {
  object: 'customers',
  mode: 'throw',
  now: () => MORNING,
});
const quarantined: unknown[] = [];
for (const record of [
  {
    customer_id: 'c5',
    customer_name: 'Ana Loe',
    annual_premium: 80000,
    customer_status: 'active',
    last_updated_at: at(MORNING),
  },
  {
    customer_id: 'c6',
    customer_name: 'Bo Ray',
    annual_premium: -5,
    customer_status: 'active',
    last_updated_at: at(MORNING),
  },
]) {
  try {
    guard.check(record);
  } catch (error) {
    if (!(error instanceof ContractViolationError)) throw error;
    quarantined.push(record);
    console.log(`quarantined ${String(record.customer_id)}: ${error.message}`);
  }
}
assert.equal(quarantined.length, 1);
guard.stop();

// ── 8. Tolerant read ───────────────────────────────────────────────────────
step('8. Tolerant read: the query a consumer runs');
const sql = tolerantSelect(contract, 'customers', legacy.options, [
  'customer_id',
  'annual_premium',
]);
assert.equal(sql, 'SELECT "customer_id", "annual_premium" FROM "customers"');
const rows = await legacy.options.query(sql);
assert.deepEqual(Object.keys(rows[0]!), ['customer_id', 'annual_premium']);
console.log(
  `${sql}  → ${rows.length} rows; a column added later changes nothing`,
);

// ── 9. Track record ────────────────────────────────────────────────────────
step('9. Track record: 30 nightly audits, recorded as OpenTelemetry metrics');
let today = MORNING - 29 * DAY;
const feed = warehouse(() => today);
for (let day = 0; day < 30; day++, today += DAY) {
  // The load at 02:00 updates every record, except on the day it stalled.
  if (day !== 17) {
    const loaded = at(today - 4 * 3_600_000);
    feed.db.exec(`
      INSERT OR REPLACE INTO customers VALUES
        ('c1', 'Alex Doe', 120000, 'active', '${loaded}'),
        ('c2', 'Sam Roe', 90000, 'lapsed', '${loaded}'),
        ('c3', 'Kim Poe', 50000, 'active', '${loaded}');
    `);
  }
  recordReports(contract, await auditDatabase(contract, feed.options));
}
await reader.forceFlush();
const freshness = new Map<string, number>();
for (const batch of exporter.getMetrics())
  for (const scope of batch.scopeMetrics)
    for (const metric of scope.metrics)
      if (metric.descriptor.name === 'datacontract.sla.checks')
        for (const point of metric.dataPoints)
          if (point.attributes['datacontract.sla'] === 'freshness')
            freshness.set(
              String(point.attributes['datacontract.outcome']),
              Number(point.value),
            );
const kept = freshness.get('kept') ?? 0;
const total = kept + (freshness.get('breached') ?? 0);
assert.equal(kept, 29);
assert.equal(total, 30);
console.log(
  `freshness kept on ${kept} of the last ${total} days (datacontract.sla.checks)`,
);

await shutdown();
console.log('\nEvery step held.');
