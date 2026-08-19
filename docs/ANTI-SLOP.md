# Anti-slop burn-down

`pnpm lint:anti-slop` runs the vendored Oxlint plugin in `tools/oxlint/anti-slop`.
Baseline when it was introduced: **6,858 findings across 803 files**.

This file tracks the burn-down and, more importantly, the findings we decided
**not** to fix and why. A finding is "addressed" when it is either fixed or
listed here with a reason. Nothing is silenced with a disable comment, and no
rule severity has been lowered.

## Notes for anyone continuing this

`require-safety-comment-for-type-assertion` does not find a comment placed above
`export const x = <assertion>`: the rule stops walking at the `VariableDeclaration`
and the comment attaches to the `ExportNamedDeclaration` above it. Hoist the
asserted value into a non-exported `const` - which reads better anyway.

### RequestLogger's fields — `no-unsafe-dictionary-type`

`logger.set()` and the canonical log line take `Record<string, unknown>`, and
narrowing it to a JSON value type was tried and reverted. Every domain object
this repo attaches to a log line is declared as an `interface`, and TypeScript
gives an interface no implicit index signature, so the narrowing forces each of
them to become a type alias - a migration across five packages for no behavioural
gain. `LogFn` is separately constrained: it mirrors Pino's own signature so a
real Pino logger stays assignable.

## Accepted exceptions

### Durable Object handler tests — assertions kept, measured

`packages/autotel-cloudflare/src/handlers/durable-objects.test.ts` keeps its
`as unknown as DurableObjectState` and `as any`. Rewriting it over the
`testing/doubles.ts` helpers is what the rest of the package does, and it type
-checks correctly — but it makes `tsc` pathological on this one file.

Measured on the package, same machine:

| `durable-objects.test.ts` | `tsc --noEmit`       |
| ------------------------- | -------------------- |
| assertions (this version) | 2s                   |
| rewritten over doubles    | >6h, never completed |

CI hit the GitHub Actions six-hour job limit on it. `--generateTrace` puts the
whole time inside `checkSourceFile` for this file with no deeper frame, and it
survives narrowing every individual change - the state double, the tracer
double, the callback lookup, annotating the mock's parameters, and pinning the
double's result to a typed binding. Whatever the interaction is between the
fourteen `instrumentDO()` instantiations here and `@cloudflare/workers-types`,
it is not any one of those edits, and a six-hour type-check is a worse defect
than the assertions it removes.

Worth retrying on a future TypeScript release; if it completes quickly, take
the rewrite. Note the explosion also **hid four genuine type errors** in
`actors/{alarms,sockets,storage}.ts` and `bindings-this-binding.test.ts`, which
only surfaced once the file was reverted and `tsc` could finish. Those are
fixed.

### Dual-format module shims — `no-runtime-typeof`

```ts
const pkgRequire = createRequire(
  typeof __filename === 'string' ? __filename : import.meta.url,
);
```

`__filename` exists in CJS and not in ESM, and a bare reference to it in ESM is
a ReferenceError, so `typeof` is the only probe that survives both builds. The
rule wants the value parsed at a boundary; there is no boundary here, only two
module formats. Kept.

- `packages/autotel-backends/src/datadog.ts`
- `packages/autotel-backends/src/grafana.ts`

### Union discrimination in a boundary parser — `no-runtime-typeof`

`normalizeHeaders` in `packages/autotel-backends/src/grafana.ts` accepts the
`OTEL_EXPORTER_OTLP_HEADERS` string form or an already-parsed record, because
both are what users have. Discriminating the two at runtime needs `typeof`; the
check cannot be removed, only moved somewhere less honest. This function _is_
the boundary the rule asks for. Kept.

### Capability probes against a beta API — `no-runtime-typeof`

`apps/cloudflare-example/src/actor.ts` guards every call into `@cloudflare/actors`
with `typeof this.alarms.set === 'function'`. The installed beta.6 typings do not
declare `alarms.set`, `storage.exec` or `storage.prepare` at all, so the guard is
what keeps the example from throwing on a runtime that does not have them. Typing
the surface locally was tried and rejected: it conflicts with the base class,
which declares both properties with different shapes. Kept until the API settles.

### Thenable detection — `no-runtime-typeof`

`apps/cloudflare-example/scripts/capture-evidence.mjs` checks
`typeof r.then === 'function'` to decide whether a callback returned a promise.
That is the definition of a thenable; `instanceof Promise` would miss the ones
this script has to handle. Kept.

### Body validation without a schema library — `no-runtime-typeof`

`apps/example-basic/src/webhook-server.ts` and
`apps/example-subscribers/src/webhook-server.ts` validate the demo trigger
payload with `typeof`. The rule asks for a schema parse instead; neither app
depends on a schema library, and adding one to an example app to satisfy a lint
rule is not worth the dependency. Kept.

### A hand-written validator's entry point — `no-unknown-parameters`

`apps/book-chapters/examples/oe-02-production-intent.ts` defines a validator
whose `safeParse(input: unknown)` is the boundary the rule wants input parsed
at. The rule flags the `unknown` that makes it a boundary. Kept.

### Deciding what a user-supplied value can become — `no-runtime-typeof`

`toAttributeValue` in `autotel-audit/src/context.ts` turns whatever a caller put
in an audit or security metadata bag into something a span can carry, and the
signal processors read attributes off spans other instrumentation wrote. The
type of the incoming value is exactly the question being asked; twenty-one
findings.

### Discriminating an OTel attribute value — `no-runtime-typeof`

An OTLP attribute arrives as `string | number | boolean | array`. Reading the
one a field is declared to hold - `asString`, `asNumber`, "is this a string
prompt name" - means discriminating that union, and there is no earlier boundary
to move the check to: the union _is_ what the wire format carries.
`autotel-langfuse` keeps ten such checks across `index.ts`, `scores.ts` and the
media type guard.

### Union discrimination the caller cannot pre-parse — `no-runtime-typeof`

Three helpers branch on whether a value is a string before rendering it:
`oneLine(content)` in the AI SDK, Langfuse and LangChain examples, and the final
output of a multi-agent run. The value is a union the SDK hands us; discriminating
it needs `typeof` and moving that check elsewhere would only relocate it. Kept.

### A runtime type validator — `no-runtime-typeof`

`autotel-schema` exists to check what a span actually carried against what the
contract declared, which means deciding at runtime whether a value is a string,
a number, a boolean or an array of those. `actualType()` in `src/validate.ts` is
that decision, and `validateScenarioSpec` is the same job for a spec authored by
hand or loaded from YAML. Eighteen findings, all `typeof`, all load-bearing. The
rule's advice - parse at the boundary - is what this package _is_. Kept.

### Wrapping an ODM we do not own — `no-runtime-typeof`, `no-reflect-apply`

`autotel-mongoose` patches mongoose's Model, Document, Query and Schema
prototypes, and its hook system dispatches on whether a handler declared a
`next` parameter. Deciding whether a captured member is a function, whether a
result is a thenable, and whether an argument is the node-style callback is what
the wrapper does. Seventy-five findings, the same shape as autotel-drizzle
below.

### Wrapping a driver we do not own — `no-reflect-apply`, `no-runtime-typeof`, `no-unknown-parameters`

`autotel-drizzle` monkey-patches drizzle's driver objects: it captures a method
off a prototype and forwards to it with `Reflect.apply(originalMethod, this,
args)`. The rule asks for "a typed function call behind a named interface", but
the whole point is that the method belongs to one of a dozen dialect classes
drizzle exports no types for, and the forward has to preserve an arbitrary
`this`. `Reflect.apply` is also the form that survives an object which shadows
`Function.prototype.apply`. Thirty-five findings across the package: the
`Reflect.apply` forwards, the probes that decide whether a driver has a given
method, and the `unknown` parameters of callbacks whose shapes belong to the
driver. `InstrumentableObject` is the one declaration holding the `any`, and
says so.

### Normalizing a ledger written by an older version — `no-runtime-typeof`

`autotel-pact/src/ledger-normalize.ts` reads ledger entries off disk that a
previous version of this package wrote, and rejects anything that does not match
the current spec. Deciding whether a field is the string, number or array the
spec calls for is the whole function. Twenty-seven findings across the package,
mostly here and in the broker's response handling.

### A library whose input is any message — `no-unknown-parameters`, `no-runtime-typeof`, `no-unsafe-dictionary-type`

`autotel-message-contract` serializes, snapshots and diffs _whatever message you
hand it_. `serialize(value: unknown)`, `deepEqual(left, right)`, `sortKeysDeep`
and the structural differ cannot name a domain type without ceasing to be a
general contract-testing library, and comparing two arbitrary values
structurally is what `typeof` is for. Forty-three findings.

Its tests define readers as plain `(value) => T` parse functions, which is the
package's own documented pattern #2. Rewriting them as Standard Schema readers
(pattern #1, the recommended one) would remove roughly fifteen of these and
exercise the better-recommended code path - it needs `zod` as a devDependency of
this package, which is a call for the repo owner rather than a lint fix.

### Hand-written boundary parsers — `no-unknown-parameters`, `no-runtime-typeof`

`packages/autotel-telemetry/src/ingest.ts` validates an HTTP body: it takes
`unknown` and checks each field with `typeof` before trusting it. That is the
boundary the rule wants input parsed at, and the rule flags the two things that
make it one. Replacing it would mean adding a schema library to a package that
has none. Kept.

### Module mocks with no injection point — `no-module-mocking`

Three mocks remain, all in `autotel-playwright`. A Playwright reporter and a
`test.extend()` fixture are constructed by Playwright itself, from a module
singleton, so there is no seam to pass a double through. The alternative is not
dependency injection but a browser and a real Playwright run, which is what the
package's own e2e suite is for. Kept:

- `src/reporter.test.ts` mocks `autotel`
- `src/index.test.ts` mocks `@playwright/test`, `autotel`,
  `autotel/test-span-collector` and `autotel/processors`

The same holds for the eleven mocks across `autotel-vitest`'s four test files:
vitest constructs the fixture and the reporter, and the module under test
reaches for `autotel` at module scope because that is the API it wraps. These
are the best candidates for conversion into integration tests that call the real
`init()` with an in-memory collector - worth doing, but a rewrite of the suite
rather than a lint fix.

### Assertions TypeScript will not take in one step — `no-chained-type-assertions`

`as unknown as APIRequestContext` in `autotel-playwright/src/index.test.ts`, and
`as unknown as ContextManagerInternals` in `autotel-vitest/src/fixture.ts`.
The compiler rejects the single-step assertion outright (TS2352: neither type
sufficiently overlaps) and names the `unknown` hop as the fix. Where the two
disagree, the compiler wins. Kept, three sites.

### Boundary modules — `no-runtime-typeof`, `no-unknown-parameters`, `no-unsafe-dictionary-type`

Each package that reads values from outside itself now has one file where that
happens, and the findings concentrate there rather than being spread across
every caller:

- `packages/autotel/src/values.ts`
- `packages/autotel-cloudflare/src/values.ts`
- `packages/autotel-devtools/src/widget/utils/json-fields.ts`
- `packages/autotel-devtools/src/widget/attrs.ts`
- `packages/autotel-devtools/src/server/otlp-types.ts`

They hold `asString`/`asNumber`/`asBoolean`/`asRecord`/`asFunction`,
`readProperty`, `toAttributeValue`, `toError` and the proxy-trap helpers. A
`typeof` check and an `unknown` parameter are what a boundary is made of; the
rules fire on them by design, and concentrating them is the point. Each
duplicate exists because the packages target different runtimes and must not
depend on one another - `autotel` is Node-side, `autotel-cloudflare` and
`autotel-devtools` are not.

### Narrowing a union TypeScript has to follow — `no-runtime-typeof`

`asString(x)` answers "is it a string" but does not narrow `x` in the else
branch, so where the _other_ arm of a union is used afterwards - an overload
that takes either a name or an options object, OTel's `startActiveSpan`
positions, a config that is either a preset name or a config object - `typeof`
stays, with a comment at each site saying that TypeScript's own operator is
what the code needs. About a dozen sites.

### Generic contracts the caller supplied — `no-known-value-widening`

`as Partial<InferBaggageType<T>>` in `business-baggage.ts` and the equivalents
in the schema-driven APIs. The mapping is the caller's own schema; TypeScript
cannot follow a computed key into a mapped type. Kept, six sites.

## Progress (2026-08-19)

Baseline when the plugin was installed: **6,858** findings across 803 files.
Now: **3,329**. Cleared: **3,529 (51%)**, over 87 commits, with `type-check` and
the package's tests green at each one.

Remaining, by package:

| Package                     | Left | Package                   | Left |
| --------------------------- | ---: | ------------------------- | ---: |
| autotel                     |  693 | autotel-terminal          |   66 |
| autotel-cloudflare          |  338 | autotel-vscode            |   64 |
| autotel-edge                |  259 | autotel-mongoose          |   64 |
| autotel-devtools            |  227 | autotel-pact              |   45 |
| autotel-mcp                 |  205 | autotel-message-contract  |   43 |
| autotel-cli                 |  193 | autotel-subscribers       |   40 |
| autotel-genai               |  165 | autotel-drizzle           |   35 |
| autotel-tanstack            |  152 | autotel-eventcatalog      |   30 |
| autotel-aws                 |  139 | autotel-audit             |   27 |
| autotel-mcp-instrumentation |  138 | autotel-web               |   26 |
| autotel-adapters            |  105 | autotel-schema            |   18 |
| autotel-plugins             |   97 | autotel-hono              |   14 |
| autotel-posthog             |   90 | (smaller packages + apps) |  ~60 |

Run `node scripts/anti-slop-report.mjs | tail -1` for the current total.

`autotel-aws` and `autotel-tanstack` are paused: an in-flight `trace()` API
redesign in `autotel/src/functional.ts` and `autotel-edge/src/functional.ts`
leaves them failing type-check for reasons unrelated to these rules.

## Progress (per-package ledger below predates the table above)

| Package                     | Baseline | Now | Fixed | Accepted |
| --------------------------- | -------: | --: | ----: | -------: |
| autotel-backends            |        9 |   3 |     6 |        3 |
| apps/cloudflare-example     |       25 |   5 |    20 |        5 |
| apps/example-canonical-logs |       15 |   0 |    15 |        0 |
| apps/example-tanstack-start |       18 |   0 |    18 |        0 |
| apps/example-subscribers    |       10 |   2 |     8 |        2 |
| apps/example-basic          |        8 |   2 |     6 |        2 |
| apps/example-drizzle        |        2 |   0 |     2 |        0 |
