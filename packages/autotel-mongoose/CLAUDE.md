# autotel-mongoose

Standalone Mongoose instrumentation with db.query.text capture and automatic PII redaction.

## Your Role

You are working on the Mongoose micro-package. It instruments Mongoose 8+ with OpenTelemetry tracing, capturing query text with redaction by default.

## Key Concepts

- **Statement capture**: Query filters, aggregation pipelines, and document payloads are serialized as `db.query.text`
- **Default redaction**: Uses autotel core's `createStringRedactor('default')`: emails, phones, SSNs, credit cards
- **Stable semconv only**: Uses `db.query.text`, `db.operation.name`, `db.system.name`, `db.collection.name`, `db.namespace`, `server.address`, `server.port`
- **OTel-compatible API**: `dbStatementSerializer` matches `@opentelemetry/instrumentation-mongodb`
- **Hooks are opt-in and selectable**: `instrumentHooks` is `false` by default and accepts the same `MethodSelector` shape as `customMethods`, so a caller can trace `save` while leaving `init` alone. `init` fires once per hydrated document; every other common hook fires once per operation.
- **Only application hooks are traced**: `isMongooseInternalHook` matches the handlers Mongoose registers in its own `lib/` by name (`shardingPlugin*`, `saveSubdocs*`, `trackTransaction*`, `timestampsPre*`, `_setTimestampsOnUpdate`, `virtualPreInit`). Keep that list matched to the dependency rather than widening it to generic words or naming conventions, which also catch application hooks.
- **Delegating methods trace once**: `findById` calls `findOne`, and both are patched, so a `buildingQuery` flag covers the synchronous window in which a traced method assembles its Query and suppresses the delegate's span. Keep the window synchronous: a query a hook starts later runs outside it and must keep its span.
- **Patching is idempotent per target, not per instance**: `Model`, `Query.prototype` and `Model.prototype` come from the mongoose module and are shared by every `new mongoose.Mongoose()`, so the already-instrumented flag on the instance cannot see them. Each installed wrapper carries `PATCHED_PROTOTYPE_FLAG` and the wrappers skip a method that already has one; without that, a second `instrumentMongoose()` call adds a layer and every operation opens an extra span.
- **Span names come from the operation, not the registration**: `pre(['save','validate'])` is split per name at registration; `pre(/^find/)` resolves its name from the Query's `op` at call time. Hooks registered either way answer to the selector one operation at a time.

## Commands

```bash
pnpm test               # Unit tests
pnpm test:integration   # Integration tests (in-memory MongoDB)
pnpm build              # Build package

# Integration tests against a server you already have, rather than a
# downloaded in-memory one. Each run gets its own database and drops it after.
MONGO_TEST_URI=mongodb://127.0.0.1:27017 pnpm test:integration
```

CI runs the integration suite in its own job against a real MongoDB. Selection
and naming are pinned twice on purpose: `hook-selection.test.ts` proves them
with no database, so they run in every job, and `hooks.integration.test.ts`
proves the same rules against a server.

## Architecture

- `src/types.ts`: Config interfaces, SerializerPayload
- `src/constants.ts`: Stable OTel semantic convention constants
- `src/statement.ts`: Serializer + redactor composition
- `src/instrumentation.ts`: Core `instrumentMongoose()` patching
- `src/index.ts`: Public API exports

## Boundaries

- ✅ **Always**: Use stable semconv constants, redact by default, match OTel MongoDB plugin API shape
- ⚠️ **Ask first**: Adding new semconv attributes, changing default redactor preset
- 🚫 **Never**: Use deprecated semconv (db.statement, db.system.name, net.peer.\*), disable redaction by default
