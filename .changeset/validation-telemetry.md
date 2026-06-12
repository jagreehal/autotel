---
'autotel': minor
---

New `autotel/validate` export — make input-validation mismatches observable at your boundaries. `defineValidator(name, schema, options)` wraps any Zod-style `safeParse` schema and records every mismatch as a `validation.*` span attribute plus an `autotel.validation.mismatches` counter, with a per-validator `reject` (record then throw a 400-shaped structured error) or `observe` (record then return raw input) mode.

PII-safe by construction: only field paths, issue codes, and the declared type are recorded — never the offending value or the validator's error message. Not a security feature by default; escalation to the security path is an explicit opt-in via `onValidationMismatch()`, never package-presence-driven. Attribute/metric constants are exported dependency-free from `autotel/validation-attributes`. Fail-open: a recorder bug never breaks the validated boundary.

`defineEvent` is unchanged (still throws on a bad payload); its schema-hash helper is now shared with the validation layer via an internal `stable-hash` module.
