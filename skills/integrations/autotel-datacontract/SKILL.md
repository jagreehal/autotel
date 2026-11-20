---
name: autotel-datacontract
description: >
  Use this skill when working with ODCS v3 data contracts: validating live records with createContractGuard() and its OpenTelemetry track record, auditing or drafting a contract from a legacy database, checking a contract change for its version bump in CI, consumer expectations with satisfies(), or JSON Schema export.
---

# autotel-datacontract

Check [Open Data Contract Standard](https://bitol-io.github.io/open-data-contract-standard/) (ODCS v3) contracts where data moves, and record each check as evidence.

Three entries:

- `autotel-datacontract`: parse, lint, diff, `satisfies`, batch checks, JSON Schema. Depends on `yaml` only and runs in the browser.
- `autotel-datacontract/db`: audit a database or draft a contract from one. You pass the query function.
- `autotel-datacontract/runtime`: the record guard and OpenTelemetry metrics. Needs `@opentelemetry/api`.

## Core patterns

### Guard a live stream

```ts
import { parseContract } from 'autotel-datacontract';
import { createContractGuard } from 'autotel-datacontract/runtime';

const { contract } = parseContract(yamlText);
const guard = createContractGuard(contract, {
  object: 'customers',
  slaIntervalMs: 3_600_000, // one freshness outcome an hour
});

guard.check(record); // records metrics and events, does not throw
```

Metrics carry `datacontract.id`, `.version` and `.object`: `datacontract.records`, `datacontract.violations`, `datacontract.sla.checks`, `datacontract.quality.checks`, `datacontract.audits`, `datacontract.freshness.age`. Paths in attributes come from the contract, so senders cannot add cardinality or personal data. `mode: 'throw'` throws `ContractViolationError` for a quarantine step.

### Audit or draft from a database

```ts
import {
  auditDatabase,
  draftContractFromDatabase,
} from 'autotel-datacontract/db';

const query = async (sql: string) => pool.query(sql).then((r) => r.rows);
const draft = await draftContractFromDatabase(
  { query, dialect: 'postgres' },
  { id: 'customers' },
);
const reports = await auditDatabase(contract, { query, dialect: 'postgres' });
```

Dialects: `postgres`, `mysql`, `sqlite`, `mssql`, `ansi`. Quality rules run over the whole table. Each report has `status`: `passed`, `failed` or `incomplete`. Feed scheduled audits to the same metrics with `recordReports(contract, reports)` from `/runtime`.

### CI

```bash
autotel-datacontract lint datacontracts/customers_v1.odcs.yaml
autotel-datacontract check base.odcs.yaml datacontracts/customers_v1.odcs.yaml    # exit 1 when under-bumped
autotel-datacontract satisfies provider.odcs.yaml expectations/cross-sell.odcs.yaml # exit 1 when unmet
autotel-datacontract verify customers_v1.odcs.yaml export.ndjson --object customers --record customers_v1.results.ndjson
```

Exit codes: `0` ok, `1` failed, `2` usage or unreadable file, `3` incomplete. `--record` appends one line per object per run, the contract's track record.

### Consumer expectations

A consumer writes what it reads as an ODCS contract. `satisfies(provider, expectation)` fills what the expectation leaves unsaid from the provider, then diffs: a weaker promise, or a missing column or server, is `unmet`. Run it in the provider's CI against each consumer's expectation.

### For agents

`auditDatabase` runs each ODCS 3.2 `context.verifiedStatements` answer and reports it under `CONTEXT_OBJECT`. `tolerantSelect(contract, object, { dialect, schema }, columns)` writes a query that names its columns and maps physical names to contract names.

## Common mistakes

### HIGH Checking freshness per record

Freshness is a scheduled check. Use `slaIntervalMs` or `guard.checkSla()` in one process per dataset, so a stopped feed records `breached`.

### HIGH Treating `incomplete` as a pass

`incomplete` means a rule, SLA or table part went unchecked. `verify` exits 3 on it.

### MEDIUM Naming files freely

`lint` checks `<id>_v<major>.odcs.yaml`: `customers_v1.odcs.yaml` holds id `customers` at a `1.x` version.

## Version

Targets autotel-datacontract. `/runtime` needs `@opentelemetry/api` as an optional peer. See packages/autotel-datacontract/README.md for the full rules.
