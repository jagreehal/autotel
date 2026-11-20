# autotel-datacontract

[Open Data Contract Standard](https://bitol-io.github.io/open-data-contract-standard/) (ODCS v3) contracts, held to account.

A data contract is only worth what checks it. This package checks it in the places data actually moves, and turns each check into evidence:

| You have                                      | Call                                               | You get                                                                                                                                                                                        |
| --------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A live stream (Kafka handler, API, ETL step)  | `createContractGuard()` from `/runtime`            | Every record validated; OpenTelemetry counters that are the contract's **track record** ("freshness kept on 29 of 30 days"); a `throw` mode for quarantine                                     |
| A legacy database nobody fully understands    | `auditDatabase()` from `/db`                       | Columns the contract does not know, columns it promises that are gone, type and nullability drift, value variances over a sample, every quality rule over the whole table, freshness/retention |
| A database and no contract yet                | `draftContractFromDatabase()` from `/db`           | A `draft` ODCS contract from the catalog plus what the data shows, to enrich and commit                                                                                                        |
| A batch or an export                          | `checkRecords()`, or `autotel-datacontract verify` | The same report, from records in memory                                                                                                                                                        |
| A pull request changing a contract            | `autotel-datacontract check old.yaml new.yaml`     | Exit 1 when the version bump is smaller than the change needs                                                                                                                                  |
| A tool that speaks JSON Schema                | `toJsonSchema()` / `fromJsonSchema()`              | A lossless-enough bridge: governance travels as `x-odcs-*`                                                                                                                                     |
| Telemetry that might leak a restricted column | `redactionKeyPatterns()`                           | Key patterns for autotel's `attributeRedactor` from `classification` and `pii:true` tags                                                                                                       |

It works with any database client you already have.

## Install

```bash
pnpm add autotel-datacontract
# for /runtime
pnpm add @opentelemetry/api
```

The root entry is dependency-light (`yaml` only), has no `node:` imports and runs in the browser. `/db` takes your driver; `/runtime` needs `@opentelemetry/api`.

## Runtime: the track record

```ts
import { readFileSync } from 'node:fs';
import { parseContract } from 'autotel-datacontract';
import { createContractGuard } from 'autotel-datacontract/runtime';

const { contract } = parseContract(
  readFileSync('datacontracts/customers_v1.odcs.yaml', 'utf8'),
);
const guard = createContractGuard(contract, {
  object: 'customers',
  slaIntervalMs: 3_600_000, // one freshness outcome an hour, in one process per dataset
});

consumer.run({
  eachMessage: async ({ message }) => {
    guard.check(JSON.parse(message.value!.toString())); // records, never throws
  },
});
```

Freshness is a **scheduled** check, not a per-record one: `guard.checkSla()` (or `slaIntervalMs`) records one outcome per SLA per window from the newest record seen, and `breached` when nothing arrived. That is what makes "kept on 29 of the last 30 days" true: a stopped feed has no records to check, and a busy hour would otherwise outvote a quiet day. Every replica that schedules it records its own outcome, so schedule it in one.

Scheduled audits feed the same instruments:

```ts
import { recordReports } from 'autotel-datacontract/runtime';

// nightly cron
recordReports(
  contract,
  await auditDatabase(contract, { query, dialect: 'postgres' }),
);
```

Metrics (attributes `datacontract.id`, `.version`, `.object`):

| Metric                        | Extra attributes                                                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `datacontract.records`        | `datacontract.outcome`: `valid`, `variant` (only unknown fields), `invalid`                                                                                                                                  |
| `datacontract.violations`     | `datacontract.violation.code`, `datacontract.violation.property`: the contract path (`lines[].qty`, `scores{}`), with `(undeclared)` in place of any key the contract does not name (`address.(undeclared)`) |
| `datacontract.sla.checks`     | `datacontract.sla`, `datacontract.outcome`: `kept`, `breached`, `unknown` (the measuring query failed). One per scheduled check                                                                              |
| `datacontract.quality.checks` | `datacontract.rule` (`property:metric`), `datacontract.outcome`: `passed`, `failed`, `not-run`. From `recordReports`                                                                                         |
| `datacontract.audits`         | `datacontract.outcome`: `passed`, `failed`, `incomplete`. From `recordReports`                                                                                                                               |
| `datacontract.freshness.age`  | histogram, seconds: arrival lag per record, newest-record age per check                                                                                                                                      |

Each violation is also an OpenTelemetry event, `datacontract.violation`, emitted through the Logs API and correlated to the active span (the same model as autotel's `ctx.event`; up to 20 per record). The active span gets `datacontract.outcome`. Values never reach telemetry, and neither do keys the payload chose: paths come from the contract, so neither cardinality nor personal data is decided by the sender.

`mode: 'throw'` throws `ContractViolationError` on a broken promise (not on an unknown field), for a quarantine step.

## Legacy databases: variances and unknowns

```ts
import { DatabaseSync } from 'node:sqlite';
import { formatReport } from 'autotel-datacontract';
import {
  auditDatabase,
  draftContractFromDatabase,
} from 'autotel-datacontract/db';

// Any client: (sql) => Promise<rows[]>
const query = async (sql: string) => pool.query(sql).then((r) => r.rows);

// No contract yet? Start from what is there.
const draft = await draftContractFromDatabase(
  { query, dialect: 'postgres' },
  { id: 'customers' },
);

// Have one? See where the data and the contract disagree.
const reports = await auditDatabase(contract, {
  query,
  dialect: 'postgres',
  sampleSize: 5000,
});
console.log(formatReport(reports));
```

Dialects: `postgres`, `mysql`, `sqlite`, `mssql` (SQL Server and Azure SQL: `TOP`, bracketed names) and `ansi` (`information_schema`, double-quoted names, `LIMIT`: Snowflake, Redshift, DuckDB, Trino; pass `schema`). A database with neither `LIMIT` nor `TOP` (Oracle) is not supported. `sql` rules substitute `{object}` and `{property}` with the catalog's quoted names, literally.

What a report holds, by severity:

- **error, broken promises**: `missing-column`, `physical-type-drift` (a TEXT column where an integer is promised), `required-missing`, `type-mismatch`, `below-minimum`, `invalid-value`, …, each with the row count and rate in the sample.
- **warning, variances the contract does not cover**: `unknown-column`, `unknown-field`, `never-present`.
- **info, gaps in the contract**: `undocumented` (no description, business name or definition), `nullable-drift` (required by the contract, but the database accepts NULL).

Quality rules run over the **whole table**: library metrics (`rowCount`, `nullValues`, `missingValues`, `invalidValues`, `duplicateValues`, with `unit: percent`) become SQL; `sql` rules run as written (`{object}` / `{property}` placeholders are substituted). A failing query is reported as `not-run` with a stable reason (`query failed (42703)`: the driver's error code, never its message, which can quote the value it rejected); pass `onQueryError` to see the raw error in-process. A query that fails for one table (the sample, the row count) leaves that table's report incomplete and the audit continues. A library rule with no SQL form here (a regex `pattern`) falls back to the sample only when the sample read the whole table, or when the sample already breaks a zero-tolerance rule; otherwise it stays `not-run`.

Freshness counts only evidence: a record or row that breaks a promise never sets the watermark, and neither does a timestamp later than now plus `maxClockSkewMs` (default 5 minutes). A newest value in the database beyond that cannot be measured against, so the SLA reports an error and the report is incomplete.

A measure evaluates a whole rule or reports it `not-run`: an `invalidValues` rule with both `validValues` and a `pattern` has no SQL form (SQL has no portable regex), so it is judged on the sample only when the sample read every row. Rules on nested fields are `not-run` over batches and tables (they are still checked per record when zero-tolerance). A freshness or retention SLA whose unit or value cannot be read is an error in the report, never dropped. Valid ODCS always loads: what this tool cannot measure (an unreadable SLA unit, an argument it does not evaluate) is a `lint` warning, and verification reports it incomplete. Schema-level `duplicateValues` with `arguments.properties` (a compound key, Bitol's example) is measured as a tuple, over the batch and with one `GROUP BY` over a table. Columns are matched to the catalog's spelling (exact, then case-insensitive), so a `physicalName` equal to the name, or a Snowflake upper-cased column, reads correctly.

**A verdict covers every row.** Per-record promises SQL can state the same way the runtime reads them run over the whole table: required and primary-key nulls and missing-value placeholders, allowed values (native `enum`, zero-tolerance lists), and numeric bounds on a column the database keeps numeric. A SQL result counts as proof only when it means what the runtime means: a column proves its type only where the engine enforces it (in SQLite the storage class of every value is counted first, since an INTEGER column can hold `'bad'`; JSON and VARIANT columns never prove object versus array), and text is compared in SQL only where the comparison can be made exact (`COLLATE BINARY` in SQLite, `BINARY` in MySQL, `::text COLLATE "C"` in Postgres for `text`, `varchar` and `citext`, since a bare `COLLATE` leaves `citext`'s case-folding operators in charge; `CHAR(n)` and enum types stay with the sample; SQL Server pads trailing spaces in every comparison and `ansi` collations are unknown, so there text promises stay with the sample). This holds for every SQL comparison of values: strict checks, aggregate rules (`invalidValues`, `missingValues`, `duplicateValues`), unique keys and compound duplicates; where no exact comparison exists, the rule falls back to the sample. A failure the sample saw always stands: if the database counts fewer, its comparison differs, and the report says so. Everything else (types the column does not enforce, patterns, lengths, `multipleOf`, date bounds, nested shapes) is checked on the sample, and when the sample did not read every row the report says which properties were checked only there and is `incomplete`. `sampleSize: Infinity` reads every row; any size other than a non-negative integer or `Infinity` is an error. Freshness and retention use the database's `MIN`/`MAX` only on a native date or timestamp column (not in SQLite, whose DATETIME holds text): text and epoch numbers do not sort as instants (`…T14:00+05:00` is earlier than `…T13:00Z`), so there the SLA is measured from the sample when it read every row, and is `unknown` otherwise. Physical types are compared with their length and precision (`VARCHAR(100)` ≠ `varchar(10)`; `VARCHAR` with no length accepts any; synonyms such as `character varying` / `varchar` and `int4` / `integer` fold).

Promises across records are checked across records: a primary key (a tuple when composite, ordered by `primaryKeyPosition`) and every `unique` column, over the whole batch, and over the whole table in an audit (nulls are not compared, as in SQL). An SLA without an `element` is measured on `slaDefaultElement`. No SLA is dropped: each has a `status` of `kept`, `breached`, `unknown` (no element and no default, as in the article's retention example; an element naming no property; an unreadable unit; values that do not read as times; a failed query), which makes the report incomplete, or `not-executable` for kinds this tool does not measure (latency, availability), which is shown but not counted.

Every ODCS 3.2 `logicalTypeOptions` key a single value can break is checked: bounds (numbers, and dates as instants), `multipleOf` in decimal (0.3 is a multiple of 0.1), integer `format` ranges (`i8` … `u128`), lengths, patterns, `minItems`/`maxItems`/`uniqueItems`, object `required` and `minProperties`/`maxProperties`, vector `dimensions`/`elementType`/`normalized`. Descriptive keys (string `format`, `timezone`, `distanceMetric`, `embeddingModel`) are not constraints. `lint` warns on an option ODCS does not define for the type, so a misspelling is not silently unenforced.

Library rules are batch measures. `invalidValues` with an allowance (`mustBeLessOrEqualTo: 5`) is judged over the batch or table; only a zero-tolerance rule (`mustBe: 0`) is also checked per record, and native `enum` is always strict.

Reports name fields by contract path only (`(undeclared)` for a key the contract does not name), so a shared report carries neither values nor the sender's keys. Drafts carry observed values (examples, inferred `enum`s) only with `observedValues: true`.

### Report status

Every report has `status`: `failed` (a promise is broken), `passed`, or `incomplete`: nothing failed, but a rule, SLA or table part that should have been checked was not (a `sql` rule over a batch with no connection, a failed query, an unsupported metric, a query returning no number, a failed sample listed in `unchecked`). An incomplete result proves nothing, so `verify` exits 3 on it. Text and custom rules are `not-executable` and do not make a report incomplete. Sampled values are read leniently (`'42'` from a numeric driver type is an integer); a JSON message is read strictly.

## CI

```bash
autotel-datacontract lint datacontracts/customers_v1.odcs.yaml

# The base version comes from git; the CLI reads files.
git show origin/main:datacontracts/customers_v1.odcs.yaml > "$RUNNER_TEMP/base.odcs.yaml"
autotel-datacontract check "$RUNNER_TEMP/base.odcs.yaml" datacontracts/customers_v1.odcs.yaml   # exit 1 when under-bumped

autotel-datacontract verify datacontracts/customers_v1.odcs.yaml export.ndjson --object customers  # exit 1 failed, 3 incomplete
autotel-datacontract satisfies datacontracts/customers_v1.odcs.yaml expectations/cross-sell.odcs.yaml   # exit 1 when an expectation is unmet
autotel-datacontract json-schema datacontracts/customers_v1.odcs.yaml --object customers > schema.json
```

Exit codes: `0` ok, `1` failed (breaking change under-bumped, broken promise), `2` usage or unreadable file, `3` incomplete.

`diffContracts` reads changes from the **consumer's** side. A provider contract is a set of promises, so weakening one is breaking: a removed property, a type change, required to optional, new enum or valid values, a removed constraint, a looser SLA, a removed or changed server (a consumer loses where it reads), a removed role or changed access. Strengthening one, or adding a server or role, is minor. Quality rules are compared part by part (keyed by `id`, then `name`, then metric): the threshold as the interval it accepts, `validValues` and `missingValues` by subset, `pattern` added or removed; a rule is breaking if any part is looser or cannot be compared, so dropping a pattern breaks even when the allowed list shrinks. Docs are a patch. Under `0.x` a minor bump may break. A version can only move forward by SemVer precedence, pre-releases included: `2.0.0` → `1.9.9` or → `2.0.0-rc.1` is a version error and `check` exits 1.

Every key is classified at every level (contract, object, property, SLA); one the tool does not know is flagged for review, never waved through. A schema object's `physicalType` (table → topic) or `logicalType`, a property's `primaryKeyPosition` or `encryptedName` are breaking. SLAs are compared in one unit (24 hours = 1 day is a patch) and in their own direction: a larger freshness or latency is looser, a smaller availability is looser; retention and unknown SLA properties are breaking and flagged for review.

Some changes need a person, not a version rule: free-text terms of use (`description.purpose`, `usage`, `limitations`), the AI `context` (instructions, constraints, verified statements), `relationships`, `dataGranularityDescription`, `status`, `price`, top-level `authoritativeDefinitions` and newly deprecated fields are flagged `review: true` (`needsReview` on the diff, a "Review by a person" line in the output). Prose can narrow what a consumer may do with the data without any structural change.

Numeric checks are exact: bounds and `multipleOf` compare the value as written (a bigint, integer text from a driver, a number's decimal form) without rounding through `Number`, so `9007199254740993n` is not a multiple of 2. `multipleOf` is decimal at runtime (19.99 is a multiple of 0.01, exactly, at any magnitude). The JSON Schema spec agrees, but Ajv divides in binary floating point by default and rejects it: construct Ajv with `multipleOfPrecision` (12 is plenty) when validating against an exported schema.

One equality decides "the same value" everywhere (duplicates, `uniqueItems`, unique keys, the diff): structural, so key order does not matter, a bigint equals the number of the same value, and `'1'` is not `1`. Dates, timestamps and times are whole RFC 3339 values, as JSON Schema `format` reads them (a real calendar date; seconds; a zone for `time` and `timestamp`): `99:99xyz` and a bare `1990-01-01` timestamp are violations. Lenient reads (database samples) accept what drivers return: Date objects, epoch numbers, no zone, a space separator. A value with no zone is read as UTC, so an SLA age never depends on the machine's zone. For a numeric property read leniently, numeric text is the number it states (a DECIMAL driver's `'1.00'` is `1`), in record checks, batch rules and duplicates alike, as SQL compares a numeric column. Enum equality is strict, as JSON Schema's is (`'42'` is not `42`; a number and a bigint of one value are equal); only `lenient` reads (database samples) accept a driver's text for a typed value. Map keys are always strings in JSON: enums and patterns on a key read its text (`'042'` is not the enum value `42`), its type and bounds read the value it stands for. an `integer`, `number` or `boolean` key is exported as the string forms the runtime reads as that type (`propertyNames: { pattern: '^-?\\d+$' }`), and the ODCS key travels in `x-odcs-mapKey`.

What JSON Schema can state is exported: safe integer `format`s (`i8`…`u32`) as `minimum`/`maximum`, vector `elementType` as item bounds, a non-negative integer map key as `^\\d+$`. What it cannot (date bounds, `i64`+, `normalized`, numeric bounds on map keys) is listed in `x-odcs-unenforced` on that node, so a consumer sees the gap; the runtime still checks it.

`toJsonSchema` emits only what one record must satisfy: `required`, native `enum` and zero-tolerance rules become `enum` / `allOf: [{ pattern }]` / `not`; an optional field is nullable, as in ODCS. A rule with an allowance is a batch measure, so it travels as `x-odcs-quality` and never becomes an `enum` that would reject the value it allows. `fromJsonSchema` restores the rules from it.

ODCS 3.2 types are read natively: `enum` (allowed values with labels), `map` (`map.key` / `map.value`, checked per entry), `vector` (`logicalTypeOptions.dimensions`), `multipleOf`.

`lint` also checks the file-name convention when a file follows it: `customers_pii_snowflake_v1.odcs.yaml` should hold id `customers_pii_snowflake` at a `1.x` version (`file-name-id`, `file-name-version` warnings). Any other name is left alone.

## Consumer-driven contracts

A consumer writes what it relies on as an ODCS contract of its own: the objects and columns it reads, the types, required fields, valid values, SLAs and servers it needs. `satisfies(provider, expectation)` checks that the provider promises at least that much, with the diff's own rules. What the expectation leaves unsaid is not expected, so a partial entry (`{ name: customer_id, logicalType: string }`, `{ server: production, type: snowflake }`) is compared only on what it states.

```ts
import { satisfies, formatSatisfaction } from 'autotel-datacontract';

const result = satisfies(providerContract, myExpectation);
// result.unmet: [{ path: 'sla.freshness:customers.last_updated_at', message: '1 hour → 24 hours' }, ...]
```

A stronger promise meets an expectation (the provider sends three of the four statuses a consumer handles; a 24-hour freshness meets a 48-hour need). A weaker one, or a column or server the provider does not offer, is `unmet`. Run it in the provider's CI against every consumer's expectation, and a change that breaks a named consumer fails before it ships.

## Semantic links

A property or object linked to an ontology concept (`authoritativeDefinitions: [{ type: semantics, url: https://example.com/ns/Customer.id }]`) says what it means, and consumers join on it. The diff reads a dropped or changed concept as breaking (the column now means something else) and a new link as additive. `satisfies` holds the provider to the concept a consumer expects. Other link types (policies, docs) are flagged for a person.

## For agents: verified statements and tolerant reads

ODCS 3.2's AI `context.verifiedStatements` pairs questions with queries the provider vouches for. `auditDatabase` runs each answer and reports them under the object `(context)` (`CONTEXT_OBJECT`): an answer that no longer runs fails the audit, since every agent that reuses it would get an error or a wrong answer. Only whether it runs is checked. Statements run when the audit covers the whole contract (no `tables` option); `checkVerifiedStatements` runs them alone.

`tolerantSelect(contract, object, { dialect, schema }, columns?)` writes the query a tolerant reader runs: the named columns, never `SELECT *`, read from their physical names under the contract's names. A column the contract does not promise throws.

```ts
tolerantSelect(contract, 'customers', { dialect: 'postgres', schema: 'dp' }, [
  'customer_id',
  'customer_name',
]);
// SELECT "customer_id", "cust_nm" AS "customer_name" FROM "dp"."tbl_cust"
```

## Scope

- SQL DDL generation, platform masking policies (Snowflake, Databricks) and ODPS data products sit outside this package.
- Full ODCS JSON Schema compliance: `lintContract` checks structure and what this package acts on, not every field of the standard.
- Native `enum` over the whole table where SQL cannot compare exactly: numbers, and text in SQLite, MySQL and Postgres `text`/`varchar`/`citext`, are counted over every row; text in SQL Server, `ansi`, `CHAR(n)` and Postgres enum types stays with the sample (an `invalidValues` rule falls back the same way), and the report is `incomplete` unless the sample read every row. Use `sampleSize: Infinity` there for a full verdict.
- `pattern` library rules over SQL (regex syntax differs per dialect); they run on samples and batches.
- Random sampling: `auditDatabase` reads the first `sampleSize` rows.
- `$ref` / `allOf` in `fromJsonSchema`: dereference first.
