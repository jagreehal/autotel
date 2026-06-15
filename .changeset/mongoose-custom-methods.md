---
'autotel-mongoose': minor
---

Automatically trace user-defined statics, instance methods, and query helpers (`schema.statics`, `schema.methods`, `schema.query`) — no manual `trace()` calls and no behavioral side effects. Each call gets an `INTERNAL` span named `mongoose.<Model>.<fn>` with `mongoose.method.*` / `code.function.name` attributes.

New `customMethods` option controls this with per-category `include`/`exclude` selectors and parameter capture config. Configuration is resolved per Mongoose instance at call time, so a schema object reused across instances/connections honors each instance's own config.

**Behavior change:** with no `customMethods` option, `instrumentMongoose()` now wraps all custom functions and captures their (redacted) arguments by default. Set `customMethods: false` to disable, or `customMethods: { captureParameters: false }` to keep call spans without serializing arguments. Note that custom-function arguments are often business payloads rather than DB filters, and the default redactor only masks known PII patterns (emails, phones, SSNs, cards).
