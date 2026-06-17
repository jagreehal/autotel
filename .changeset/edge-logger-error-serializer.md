---
'autotel-edge': patch
---

fix(logger): serialize Error objects in the error key

Logging an Error inside the configured error key — e.g. `log.error({ err }, 'msg')`
— previously JSON-stringified the Error to `{}`, dropping the message and stack.
The edge logger now registers a default serializer for `errorKey` (default
`'err'`) that emits `{ message, type, stack }`, mirroring the first-argument
Error shape. Overridable via `options.serializers`.
