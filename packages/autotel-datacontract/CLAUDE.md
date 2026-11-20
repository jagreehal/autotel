# CLAUDE.md: autotel-datacontract

ODCS v3 data contracts checked where data moves: runtime guard with OTel track-record metrics, driver-agnostic database audit and draft, batch checks, consumer-side breaking-change diff, JSON Schema bridge, redaction from classification.

## Design invariants

- **Three entries, three dependency levels.** `.` is `yaml` only, no `node:`, no OTel: browser-safe, so readers (catalogs, devtools) share it. `./db` takes a `QueryFn`; never add a driver dependency. `./runtime` is the only file importing `@opentelemetry/api` (optional peer).
- **One validator.** `validateRecord` is the single source of value rules; `checkRecords` aggregates it, `auditDatabase` runs `checkRecords` on a sample (`lenient: true`), the guard calls it per record. Add a rule there, not in a caller.
- **No values, and no payload-chosen keys, in output that leaves the process.** Violations carry `actual` as a type name, never the value. Telemetry uses `Violation.schemaPath` (contract path, `(undeclared)` in place of an unknown key, `[]` / `{}` for items and map values), never `path`. Reports aggregate by `schemaPath` too. Query failures become `queryFailure(error)` (driver code only); the raw error goes to `onQueryError`, called only by `runQuery` (once per failed statement, with its SQL). `inferObject` puts observed values (examples, enums) in a draft only with `observedValues: true`.
- **Events go through the Logs API** (`logs.getLogger().emit` with `eventName`, as autotel's `ctx.event`), never `Span.addEvent`.
- **Track record = one outcome per window.** Freshness is counted by the scheduled `checkSla()` / `recordReports()`, never per record: a stopped feed must read as breached.
- **One reading of strictness.** `constraints.ts` `strictConstraints(prop)` is what one record must satisfy (required/primary key, native enum, zero-tolerance `nullValues` / `missingValues` / `invalidValues`). `validateRecord` and `toJsonSchema` both use it; do not re-derive strictness elsewhere. JSON Schema carries only that (optional fields are nullable), plus every rule as `x-odcs-quality`.
- **Whole rules or none.** `unmeasurable(rule, supported)` names any argument a measure does not evaluate; the measure then reports `not-run`, never a partial pass. SQL supports no `pattern`. Rules on nested fields are `not-run` over batches and tables (`nestedRulesNotRun`).
- **No silent drops.** An SLA the tool cannot read (unit, value) comes back from `slasFor` with `error`. Columns resolve through the catalog (`columnOf`: exact, then case-insensitive) for row mapping and every SQL identifier.
- **Cross-record promises are cross-record.** `uniqueKeys` / `countDuplicates` (constraints.ts) for the batch; one `GROUP BY … HAVING` per key over the table in an audit. The runtime guard checks one record and cannot see duplicates.
- **Options are checked by type in one place.** `checkOptions` (validate.ts) for values; `KEYWORDS` + `typeKeywords` (json-schema.ts) for what JSON Schema can state, the rest under `x-odcs-logicalTypeOptions`. `lint` warns on options ODCS does not define (`OPTIONS_BY_TYPE`).
- **The diff classifies every key.** `OBJECT_KEYS` / `PROPERTY_KEYS` / `TOP_KEYS` / `DESCRIPTION_KEYS`; an unlisted key is `review`. Add a key there, never a silent fallthrough.
- **Replacement strings never carry data.** Substitute with a callback (`$&` in a name is a pattern otherwise), in one pass.
- **Valid ODCS always loads.** Lint errors only for what makes a contract invalid or self-contradictory (ODCS-required fields, bad shapes). "This tool cannot measure it" is a warning plus `not-run`, never a load failure: a contract must stay loadable to diff it.
- **Rule diffs are directional per part.** `compareRule` (diff.ts): threshold as an accepted interval, argument lists by subset, anything unreadable is `unknown` = breaking. Never shortcut on one argument.
- **One reading of map keys.** `keyValue` + `INTEGER_TEXT` / `NUMBER_TEXT` (validate.ts) for runtime; `keySchema` (json-schema.ts) exports the same text forms. Tests check agreement with a real 2020-12 validator (Ajv, devDependency).
- **Exact decimal arithmetic.** `isMultiple` is BigInt over decimal text (integers exact as BigInt); no tolerance fallback anywhere.
- **A verdict covers every row, and SQL proves only what it means.** `coverage` (db.ts) is the one decision per property: full-table SQL whose meaning equals the runtime's, else `residual` (sample-only, `incomplete` on a partial sample). Types count as enforced only via `storageMatches` (SQLite storage classes counted; shape types never); text only via `exactText` (per-dialect exact comparison, else residual; Postgres casts `::text` before `COLLATE "C"` and only for `POSTGRES_PLAIN_TEXT`, read through `udt_name`). A SQL count below the sample's never replaces it.
- **Every SQL value comparison goes through `exactOperand`** (db.ts): `=`, `IN`, `NOT IN`, `DISTINCT`, `GROUP BY`, in strict checks, aggregate rules and unique keys alike. Undefined means no SQL: the sample decides.
- **One structural equality.** `canonical` / `sameStructure` (equality.ts) for duplicates, `uniqueItems`, unique keys and every diff comparison; never `JSON.stringify` or `String()` for equality.
- **Versions move forward.** `compareSemver` (SemVer §11, pre-release aware); a decrease is a `versionError`.
- **SLAs have a status, never a silent drop.** `slasFor` returns every SLA bearing on an object (unattached ones on every object) with `error` or `skipped`; `measureSla` turns them into `unknown` / `not-executable`. Status counts `breached` (failed) and `unknown` (incomplete).
- **Generated counts are bigint.** Every generated `COUNT` goes through `countOf` (`COUNT_BIG` on SQL Server, whose `COUNT` is an int).
- **Audits find views; drafts read tables.** `introspect(options, kinds)`: an audit passes `['table', 'view']` so a declared view is found; `TableInfo.kind` keeps what the catalog holds, and a declared object `physicalType` that differs is `physical-type-drift` at `$`.
- **Temporal = RFC 3339** (`isDate` / `isTime` / `isDateTime`, checked against ajv-formats full mode); lenient drops the zone requirement. Bounds hold for date, timestamp and time (`exactInstant`: exact decimal seconds, every fractional digit kept; a time is read on 1970-01-01, zone applied, as ajv-formats compares times). Every value `matchesType` accepts is bounded: lenient epoch numbers read by `isEpochSeconds` (validate.ts), the one convention `toEpochMs` (sla.ts) also uses. `instantOf` reads zone-less values as UTC. SLA conversion (`toEpochMs`) reads text through `exactInstant`, the bounds' reading, so a leap second the validator accepts also counts as freshness.
- **Equality modes.** `equalityMode(prop, options)` → `strict` | `lenient` | `lenient-numeric`; `sameValue` and `canonicalNumeric` follow it in records, batch rules and duplicate keys. Exact decimals live in decimal.ts.
- **Strict equality by default.** `sameValue` is JSON Schema's equality; lenient adds driver text. Map-key enums and patterns read the key text.
- **Exact numbers end to end.** `decimalOf` / `compareDecimal` (validate.ts) from the original value (bigint, text, number); never `Number(value)` before a check.
- **Export states or names.** A runtime constraint JSON Schema cannot state goes in `x-odcs-unenforced` on that node (`unenforced()` in json-schema.ts).
- **Catalog types are full.** `fullType` keeps length/precision; `samePhysicalType` compares base + arguments with synonyms folded.
- **Batch vs record.** Library rules are batch measures; `validateRecord` enforces one only when `isZeroTolerance(rule)`. Native `enum` is strict.
- **SLA order is instant order.** `measureTableSla` uses SQL `MIN`/`MAX` only where `sortsAsInstants` (a native date/timestamp column, never SQLite); otherwise the whole sample, else `unknown`. `sampleSizeOf` / `rowLimit`: a non-negative integer or `Infinity`, anything else throws before any query.
- **Unreadable values: retention is every value, freshness is evidence.** A non-null value that does not read as a time leaves retention `unknown` unless a readable value already breaches it, and rejected rows still count for retention (they are kept). For freshness an unreadable or rejected value is no evidence: it never overturns a breach (only "present, none readable" is `unknown`). `toEpochMs` returns only finite times (NaN, ±Infinity, an invalid Date are unreadable), and Dates become text only through `dateText` (equality.ts), never a bare `toISOString`, which throws on an invalid Date. One rule in `measureSla`; batch, sample and SQL paths pass `unreadable` when any present value fails to read.
- **Evidence-only freshness.** Rejected records/rows and timestamps beyond `maxClockSkewMs` never set the watermark (`usableTimestamp`); a future newest value is an SLA `error`.
- **Samples prove only what they cover.** The no-SQL fallback uses the sample when it read every row, or when it already fails a zero-tolerance rule. "Read every row" is `wholeTable` in `auditTable`: the sample asks for `sampleSize + 1` rows and got at most `sampleSize`, and it is not shorter than the row count. The count alone is never proof: a row inserted after it would go unseen.
- **SemVer is whole-string.** `parseSemver` rejects `2.0.0junk`; the diff sets `versionError` and `ok: false`.
- **Three-way status.** `failed` > `incomplete` > `passed`. A rule that should run but did not (`not-run`) makes a report incomplete, and CI exits 3; `not-executable` (text/custom) does not.
- **Consumer expectations reuse the diff.** `satisfies(provider, expectation)` fills what the expectation leaves unsaid from the provider (`fillEntry`: objects and properties by name, SLAs by property and element, servers and roles by key) and runs `diffContracts(filled, provider)`; breaking = unmet. Never write a second comparison.
- **Semantic links are meaning.** `diffDefinitions`: a dropped or changed `type: semantics` link on an object or property is breaking, a new one additive, other links review.
- **Verified statements must run.** `checkVerifiedStatements` runs each `context.verifiedStatements[].answer` verbatim in `auditDatabase` (whole-contract audits only) as the `(context)` report; a failing answer is `failed` with `error`, a missing answer `not-run`. No result values are kept.
- **Consumer-side diff.** Weakening a promise is breaking, including a removed/changed server or role. Free-text terms, status, price and deprecation are `review: true`. This is the reverse of `autotel-schema`'s producer-side diff; do not "fix" one to match the other.
- **SQL safety.** Everything interpolated into SQL goes through `quoteIdent` / `quoteLiteral` (MySQL also escapes backslash). `sql` quality rules run verbatim: the contract is trusted repository content, like a migration.
- **Never throw out of an audit for one bad query.** Failed quality queries become `not-run`, failed SLA queries `error`, a failed sample or row count goes in `unchecked`, and the next table is audited; only catalog introspection failures throw.

## Source map (`src/`)

- `contract.ts`: ODCS types, `parseContract` (YAML/JSON/object, throws `DataContractError` on lint errors), `lintContract`, `meetsThreshold`, `ruleMetric` (folds 3.0 `rule` names into 3.1 `metric`), `durationMs`.
- `validate.ts`: `validateRecord` → `Violation[]`, nested objects and array items, `matchesType` (strict vs lenient).
- `profile.ts`: `profileRecords`, `inferObject` (data-first draft), `checkRecords` → `CheckReport`, `contractGaps`, `report`.
- `sla.ts`: `slasFor`, `measureSla` (freshness = newest age, retention = oldest age), `toEpochMs`.
- `db.ts` (`./db`): `introspect`, `sampleRows`, `auditDatabase`, `checkVerifiedStatements`, `tolerantSelect`, `draftContractFromDatabase`, `logicalTypeOf`, quoting.
- `runtime.ts` (`./runtime`): `createContractGuard` (`check`, `checkSla`, `slaIntervalMs`), `recordReports`, `ContractViolationError`, `DATACONTRACT_ATTRS`.
- `diff.ts`: `diffContracts` → `{ changes, required, declared, ok }`, `formatDiff`, `satisfies` / `formatSatisfaction` (consumer-driven).
- `json-schema.ts`: `toJsonSchema` / `fromJsonSchema`, `x-odcs-*` keywords for what JSON Schema cannot say.
- `redaction.ts`: `sensitiveFields`, `redactionKeyPatterns` → autotel `attributeRedactor.keyPatterns`.
- `format.ts`: `formatReport` (markdown). `cli.ts`: `lint | diff | check | satisfies | verify | json-schema`.

## Conventions

`pnpm test` (vitest; `db.test.ts` uses in-memory `node:sqlite`; `DATACONTRACT_PG_DOCKER=1 pnpm test` adds `db.postgres.integration.test.ts`, which starts a throwaway `postgres:17-alpine` with citext, an ICU case-insensitive collation, CHAR(n) and an enum type), `pnpm lint`, `pnpm type-check`, `pnpm build`. Fixture: the ODCS customers example in `src/__fixtures__/`.
