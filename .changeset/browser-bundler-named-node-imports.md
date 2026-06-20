---
'autotel': patch
---

Fix browser/edge bundlers failing to build when `autotel` is in the module graph.

Several modules imported Node builtins with **named** imports (e.g.
`import { createRequire } from 'node:module'`,
`import { AsyncLocalStorage } from 'node:async_hooks'`, plus `node:crypto`,
`node:fs`, `node:url`). When a downstream app bundles for the browser, tools like
Vite rewrite Node builtins to a stub that exports nothing, and Rollup hard-errors
on the unresolved named binding ("`createRequire` is not exported by
`__vite-browser-external`") — breaking the consumer's build even when the code is
only ever reached on the server.

These are now namespace imports (`import * as nodeModule from 'node:module'`,
accessed as `nodeModule.createRequire`), which carry the runtime value without a
named binding for the bundler to resolve. Where a builtin was used only as a type
(`AsyncLocalStorage<T>`), a `import type` is used, which is erased at build. Node
runtime behaviour is unchanged. The built `dist` now contains no named imports of
Node builtins.

A lint guard (`no-restricted-syntax` in `eslint.config.mjs`) now bans named value
imports of `node:` builtins in `src`, so this can't silently regress —
`import type` and namespace imports remain allowed.

Also includes incidental, behaviour-preserving lint cleanups in `request-logger.ts`
(`let` → `const`, redundant `?? {}` spreads removed) surfaced while touching the file.
