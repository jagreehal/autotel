---
"autotel": patch
"autotel-backends": patch
"autotel-mcp": patch
---

Make `createRequire(import.meta.url)` survive ESM→CJS rebundling by downstream consumers.

`packages/autotel/src/node-require.ts` and three other call sites
(`autotel-backends/src/{datadog,grafana}.ts`, `autotel-mcp/src/version.ts`) used `createRequire(import.meta.url)` directly. That works in:

- native CJS (autotel's published `.cjs`) — `import.meta.url` is rewritten by tsup
- native ESM (autotel's published `.js`) — `import.meta.url` is the real URL

…but **breaks** when a downstream consumer (e.g. CDK's `aws-lambda-nodejs`, which runs esbuild with `format: cjs`) re-bundles the ESM `.js` files into a CJS Lambda output. esbuild rewrites `import.meta` to `{}` in CJS output, so `createRequire(import.meta.url)` collapses to `createRequire(undefined)` and throws `ERR_INVALID_ARG_VALUE` at cold start:

```
TypeError [ERR_INVALID_ARG_VALUE]: The argument 'filename' must be a file URL object,
file URL string, or absolute path string. Received undefined
  at createRequire (node:internal/modules/cjs/loader:2025:11)
```

All four sites now use the cross-format pattern:

```ts
declare const __filename: string | undefined;
createRequire(typeof __filename === 'string' ? __filename : import.meta.url);
```

`typeof __filename` is safe against an undeclared identifier (it returns `'undefined'` rather than throwing), so the ESM build evaluates the conditional cleanly and falls through to `import.meta.url`. esbuild's CJS output wrapper provides `__filename` at runtime, so bundled CJS picks that branch.

This is the third in a series of fixes (after #164 and #166) that make `autotel-aws/lambda` work end-to-end inside a CDK-bundled Lambda. With this patch landed, no consumer-side `define: { 'import.meta.url': '__filename' }` workaround is required.
