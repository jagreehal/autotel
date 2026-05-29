---
'autotel-devtools': patch
---

Fix OTLP/protobuf ingestion failing with `protobuf.Root is not a constructor` in the published bundle.

`otlp-proto.ts` imported protobufjs with `import * as protobuf`, which under esbuild's CJS→ESM interop left `protobuf.Root`/`protobuf.parse` undefined in the bundled ESM output — the form `npx autotel-devtools` runs. Every protobuf POST (the default for the Python/Java/Go SDKs over `http/protobuf`) was rejected with HTTP 400. Switched to a default import so the constructors resolve in both the ESM and CJS bundles.

Added a regression guard that loads the built `dist/` bundle in a real Node process and decodes an OTLP/protobuf payload (`scripts/check-dist-esm.mjs`, run via the `otlp-proto.dist.test.ts` suite test and gated on publish through `prepublishOnly`). Source-level and vitest tests could not catch this because vite's loader resolves CJS interop differently than Node.
