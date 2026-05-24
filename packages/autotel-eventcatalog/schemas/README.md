# Published JSON Schemas

These files are the **public contract** for `autotel-eventcatalog`'s JSON
output. Downstream tooling (your own GitHub Actions, dashboards, Slack
bots, CI scripts) should validate against them.

| File                                                       | Emitted by                      | `spec:` value                               |
| ---------------------------------------------------------- | ------------------------------- | ------------------------------------------- |
| [`drift-report-v0.2.0.json`](./drift-report-v0.2.0.json)   | `drift --format json`           | `autotel-eventcatalog-report/v0.2.0`        |
| [`drift-summary-v0.2.0.json`](./drift-summary-v0.2.0.json) | `drift --summary-output <path>` | `autotel-eventcatalog-drift-summary/v0.2.0` |
| [`stamp-summary-v0.1.0.json`](./stamp-summary-v0.1.0.json) | `stamp --summary-output <path>` | `autotel-eventcatalog-stamp-summary/v0.1.0` |
| [`generate-summary-v0.1.0.json`](./generate-summary-v0.1.0.json) | `generate --summary-output <path>` | `autotel-eventcatalog-generate-summary/v0.1.0` |

For consumption examples and the version policy, see
[`docs/CONTRACT.md`](../docs/CONTRACT.md).

## Version policy in one sentence

The version segment in each schema's `$id` (`v0.1.0`) follows semver.
**Minor** bumps add optional fields; **major** bumps break shape. The
`spec:` field on every emitted envelope is your one-way gate against
unknown majors.

## Validation example

These schemas use only standard JSON Schema 2020-12 features, so any
mainstream validator works:

```typescript
import Ajv from 'ajv';
import schema from 'autotel-eventcatalog/schemas/drift-summary-v0.2.0.json';

const ajv = new Ajv();
const validate = ajv.compile(schema);

if (!validate(parsedJson)) {
  throw new Error(`Invalid drift summary: ${ajv.errorsText(validate.errors)}`);
}
```

## Why these live in the package, not on a CDN

So that the schema version you validate against is always exactly the
version your CLI emitted. `npm` is the source of truth; pin the package
version and the schemas are pinned with it.
