---
'autotel-mongoose': patch
---

fix(autotel-mongoose): stop corrupting hook args and leaking hook spans

Schema hook wrapping now preserves the handler's arity and decides callback-style
at call time, fixing three defects when `instrumentHooks: true`:

- **Positional args no longer scrambled.** `post('findOneAndUpdate', (doc, next) => ...)`
  and similar shapes now keep `doc` in its declared position instead of receiving the
  synthetic callback in its place.
- **Error-handling middleware fires again.** The wrapper previously collapsed every
  handler's arity to 0/1, so Kareem stopped recognising `post('save', (err, doc, next))`
  as error-handling middleware — silently disabling users' error handling and running it
  on the success path with corrupted arguments. Arity is now preserved via
  `Object.defineProperty`, restoring Kareem's exact-arity checks.
- **Spans no longer leak for synchronous data hooks.** `post('save', (doc) => {})` (and
  the same shape on `validate`, `findOne`, `deleteOne`, `insertMany`, `aggregate`,
  `init`) now finalize instead of hanging open, because callback-style is determined by
  an actual callback at the declared parameter position rather than by arity alone. This
  also removes the need for the `init`-specific carve-out.
