---
'autotel-tanstack': patch
---

fix(autotel-tanstack): stop recording redirect()/notFound() as span errors

TanStack Router's `redirect()` and `notFound()` throw control-flow signals that
the framework turns into a real response — they are not application errors. The
loader, server-function, middleware, and handler wrappers caught them in the
same `catch` block as real errors and called `recordError`/`recordException`
(and, in middleware, `reportError`), producing phantom error spans and error
events for every redirect and not-found.

The one place that tried to special-case them checked
`error.name === 'RedirectError' | 'NotFoundError'`, which no longer matches
current TanStack: `redirect()` throws a `Response` with an `.options` bag and
`notFound()` throws an object with `isNotFound === true`. A single shared
`isControlFlowSignal` helper now recognises both the current and legacy shapes
and is used by all seven catch sites, which mark the span OK and rethrow the
signal untouched.
