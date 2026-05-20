---
"autotel-aws": patch
---

Preserve side effects of the `autotel-aws/lambda/auto` entry point so bundlers don't drop the init call.

The package previously declared `"sideEffects": false` for the entire package. That was correct for the regular entries (which only export functions/types), but wrong for `./lambda/auto`, whose sole purpose is to run `init()` on import. esbuild — used by CDK's `aws-lambda-nodejs` bundler, Cloudflare Workers, and others — honored the package-level claim and silently removed the bare import, leaving deployed Lambdas without telemetry. esbuild emits a warning like:

```
▲ [WARNING] Ignoring this import because ".../autotel-aws/dist/lambda-auto.js"
   was marked as having no side effects [ignored-bare-import]
```

`sideEffects` is now a whitelist that retains `./dist/lambda-auto.js` and `./dist/lambda-auto.cjs`. The other entry points keep their tree-shake-friendly status — only the auto-init module is pinned.

No source changes; this is a packaging fix only.
