---
"autotel-aws": minor
---

Align `LambdaContext` with the standard `aws-lambda` `Context` type.

Previously `LambdaContext` was a hand-rolled subset of the Lambda context interface (6 fields plus an index signature). The index signature *looked* like it absorbed the difference, but TypeScript's structural compatibility still required the missing fields (`callbackWaitsForEmptyEventLoop`, `logGroupName`, `logStreamName`, `done`, `succeed`, `fail`) — so consumers passing the standard `aws-lambda` Context into `wrapHandler`, `traceLambda`, or `tracingMiddleware`, or threading the context through their own helpers typed with `aws-lambda`'s `Context`, hit `TS2740` and had to narrow or cast.

`LambdaContext` is now a type alias for `aws-lambda`'s `Context`. `@types/aws-lambda` moves from `devDependencies` into runtime `dependencies` so consumers automatically resolve the re-exported type without having to add the dep themselves. `createMockLambdaContext` was updated to satisfy the full shape.

This is a minor bump rather than a patch because the public surface widens — handlers wrapped by `wrapHandler`/`traceLambda` now receive a context typed as the standard Lambda `Context`, which is a richer type than before. If anything previously relied on `LambdaContext`'s `[key: string]: unknown` index signature to access arbitrary properties, that access path no longer compiles; switch to standard `Context` fields or cast.
