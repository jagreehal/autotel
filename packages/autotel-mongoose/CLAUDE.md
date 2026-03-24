# autotel-mongoose

Standalone Mongoose instrumentation with db.query.text capture and automatic PII redaction.

## Your Role

You are working on the Mongoose micro-package. It instruments Mongoose 8+ with OpenTelemetry tracing, capturing query text with redaction by default.

## Key Concepts

- **Statement capture**: Query filters, aggregation pipelines, and document payloads are serialized as `db.query.text`
- **Default redaction**: Uses autotel core's `createStringRedactor('default')` — emails, phones, SSNs, credit cards
- **Stable semconv only**: Uses `db.query.text`, `db.operation.name`, `db.system.name`, `db.collection.name`, `db.namespace`, `server.address`, `server.port`
- **OTel-compatible API**: `dbStatementSerializer` matches `@opentelemetry/instrumentation-mongodb`

## Commands

```bash
pnpm test               # Unit tests
pnpm test:integration   # Integration tests (mongodb-memory-server)
pnpm build              # Build package
```

## Architecture

- `src/types.ts` — Config interfaces, SerializerPayload
- `src/constants.ts` — Stable OTel semantic convention constants
- `src/statement.ts` — Serializer + redactor composition
- `src/instrumentation.ts` — Core `instrumentMongoose()` patching
- `src/index.ts` — Public API exports

## Boundaries

- ✅ **Always**: Use stable semconv constants, redact by default, match OTel MongoDB plugin API shape
- ⚠️ **Ask first**: Adding new semconv attributes, changing default redactor preset
- 🚫 **Never**: Use deprecated semconv (db.statement, db.system, net.peer.\*), disable redaction by default
