# autotel-pact JSON Schemas

The **public contract** for `autotel-pact`'s persisted artifacts.

| File | Emitted by | `spec:` value |
|------|------------|---------------|
| [`ledger-entry-v0.2.0.json`](./ledger-entry-v0.2.0.json) | Wrappers, processor, provider verify | `autotel-pact-ledger-entry/v0.2.0` |
| [`audit-matrix-v0.2.0.json`](./audit-matrix-v0.2.0.json) | `autotel-pact audit --json` | `autotel-pact-audit-matrix/v0.2.0` |

v0.2 covers:

- `source` (`test` | `production`) and `role` (`consumer` | `provider`) on every interaction row.
- A discriminated `type: 'provider_verification_run'` record for run-level provider failures that cannot be attributed to a single interaction.
- Renamed audit-matrix count fields: `contracted_and_test_seen`, `contracted_not_test_seen`, `test_or_prod_seen_not_contracted`.

## Version policy

Minor bumps add optional fields; major bumps break shape. The `spec` field is the gate against unknown majors.

```ts
import { LEDGER_ENTRY_SPEC, AUDIT_MATRIX_SPEC } from 'autotel-pact';
```

Readers reject unknown `spec` values. There is no legacy migration path; v0.1 was never released.
