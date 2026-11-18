---
'autotel': patch
---

Errors thrown out of `trace()` now carry `error.type`, resolved the same way as `ctx.recordError()`, so thrown and recorded errors group together.

- `error.type` (and the thrown span's `exception.type`) is the error's own `name`, otherwise its class. `{ name: 'Timeout' }` records as `Timeout`. An `error.type` you set before throwing stays.
- Errors from `node:vm` or an iframe keep their name, message and stack.
- Your original error reaches the caller and your `shouldKeepTrace()` unchanged, even when its getters throw. The span records the failure and ends.
- An `isError` option that throws counts the value as a failure.
- The exception event keeps the error's `code` as its `exception.type`.
