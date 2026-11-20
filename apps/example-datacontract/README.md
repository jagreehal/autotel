# example-datacontract

The contract from [Data Contracts](https://martinfowler.com/articles/data-contracts.html) (Harrer & Wider), held to account with [`autotel-datacontract`](../../packages/autotel-datacontract), against a SQLite stand-in for the warehouse.

```bash
pnpm start            # the whole story; every step asserts what it shows
pnpm contract-check   # what CI runs: lint, then the consumer's expectations
```

| Step | Article                                           | API                                           |
| ---- | ------------------------------------------------- | --------------------------------------------- |
| 1    | Machine-readable, named `<id>_v<major>.odcs.yaml` | `lintContract(value, fileName)`               |
| 2    | Data-first: draft from existing data              | `draftContractFromDatabase`                   |
| 3    | Test production every night                       | `auditDatabase`, `formatReport`               |
| 4    | AI context: verified statements                   | audited as the `(context)` report             |
| 5    | Breaking change under a minor bump fails the PR   | `diffContracts`, `autotel-datacontract check` |
| 6    | Consumer-driven data contracts                    | `satisfies`, `autotel-datacontract satisfies` |
| 7    | Quarantine pattern                                | `createContractGuard({ mode: 'throw' })`      |
| 8    | Tolerant reader, no `SELECT *`                    | `tolerantSelect`                              |
| 9    | Track record: "kept on 29 of the last 30 days"    | `recordReports` → `datacontract.sla.checks`   |

Restricted and `pii:true` columns are kept out of telemetry with `redactionKeyPatterns(contract)` passed to `init({ attributeRedactor })`.

- `datacontracts/customers_v1.odcs.yaml`: the article's contract. Retention is given an `element`, so it can be measured.
- `expectations/cross-sell.odcs.yaml`: what the cross-sell model relies on, written by its team.
