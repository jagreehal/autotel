---
'autotel': minor
---

**trace()** now supports a **zero-argument factory pattern**: when you pass a function that takes no parameters and returns another function, `trace()` correctly detects it as a trace factory and instruments the returned function. Use this for patterns like logging context factories, e.g. `trace(() => (i: number) => i + 1)` or `trace('fetchData', () => async (query: string) => ...)`.
