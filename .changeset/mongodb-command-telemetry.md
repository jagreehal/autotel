---
'autotel': minor
'autotel-db': patch
'autotel-mongodb': minor
'autotel-mongoose': minor
---

Trace MongoDB commands and Mongoose transactions, and mark returned error Results on the span.

**autotel**

- `trace({ name, result: true }, fn)` marks the span ERROR and sets `error.type` when the function returns `{ ok: false, error }`.
- One warning names an OTLP endpoint that refuses connections, with the command that starts `autotel-devtools`.

**autotel-mongodb**

- `traceMongoCommands(new MongoDBInstrumentation())` gives native driver spans (3 to 7) value-free `db.query.text` and the `db.collection.name` of the command they ran. It supersedes `serializeMongoCommand`, now deprecated, which shows the collection as `?`.
- `serializeMongoPayload` and `mongoPayloadKey` give a Mongoose operation's text and hash key.
- `serializeMongoStatement` keeps one entry per shape in `$or`, `$and` and `$nor`, and each entry of other arrays in order.

**autotel-mongoose**

- `mongoose.transaction` spans with `db.transaction.attempts` and `db.transaction.outcome`, plus commit and abort spans.
- One `db.statement.hash` per write, whatever document it carries or fields it sets. Text shows written documents as `?`, shorthand updates as `$set`, and up to 512 characters of an update. Write hashes and text take new values.
- `SerializerPayload.updatePipeline` holds an update that is a pipeline.

**autotel-db**

- `queryIdentity()` groups statements by collection as well as text, under new key strings.
