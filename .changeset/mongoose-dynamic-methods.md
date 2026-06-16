---
'autotel-mongoose': minor
---

Trace dynamically-attached statics/methods and callback-style methods more
faithfully.

- **Callback-style custom methods** (Node convention: a trailing function
  argument, e.g. `doc.checkValidationErrors(cb)`) now keep their span open and
  active until the callback fires, and run the callback inside the span's
  context. Previously the span finalized on the synchronous return, so the
  method's real work — and any DB calls made inside the callback — were orphaned
  rather than nested under the method span.
- **Compiled Models attached to a schema** (e.g. `schema.statics.Patches =
  mongoose.model(...)`, the pattern used by history/audit plugins) are no longer
  wrapped. Wrapping a Model in a tracing function dropped its own statics
  (`find`, `create`, …) and broke callers; such Models are now skipped at both
  the compile-time scan and on later assignment.
- **Statics / methods / query helpers added after instrumentation** (a late
  plugin, or an extension assigned after the model first compiles) are now
  wrapped via a write-trapping proxy on the schema collections, so tracing no
  longer depends on the order in which custom functions are attached relative to
  `instrumentMongoose()`.
