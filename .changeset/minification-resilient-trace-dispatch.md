---
"autotel": minor
"autotel-aws": patch
---

Make `trace(name, fn)` dispatch survive minified parameter names.

`autotel`'s `trace(name, fn)` dispatches between immediate-execution (`(ctx) => result`) and factory-wrap (`(arg) => result`) modes by inspecting the first parameter NAME of `fn` against an allowlist (`ctx`, `traceContext`, etc.). When a consumer's bundler minifies — esbuild's `minify: true`, terser, etc. — `ctx` is renamed to a single letter, the allowlist stops matching, trace falls into factory mode, and the wrapped function is returned instead of awaited.

For `autotel-aws/lambda`'s `wrapHandler` this caused deployed Lambdas to crash at invocation time with `TypeError: Wrong arguments at _RAPIDClient.postInvocationResponse` — the runtime received a function as the response and couldn't serialize it.

**New API in `autotel`**: `markAsImmediate(fn)` attaches a symbol to `fn` that pins it to immediate-execution dispatch, bypassing parameter-name introspection. Library authors who wrap user handlers should use it.

**Fix in `autotel-aws`**: `wrapHandler` and `traceLambda` now wrap their inner trace function with `markAsImmediate(...)`, making them robust to downstream minification.

No source changes are required for users of `wrapHandler`/`traceLambda` — the fix is internal. Users calling `trace(name, fn)` directly in their own code with a minifier on the call site can apply `markAsImmediate` themselves if needed.
