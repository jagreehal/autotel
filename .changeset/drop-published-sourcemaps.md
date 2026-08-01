---
'autotel': patch
'autotel-adapters': patch
'autotel-agents': patch
'autotel-audit': patch
'autotel-aws': patch
'autotel-backends': patch
'autotel-cli': patch
'autotel-cloudflare': patch
'autotel-devtools': patch
'autotel-drizzle': patch
'autotel-edge': patch
'autotel-eventcatalog': patch
'autotel-genai': patch
'autotel-hono': patch
'autotel-mcp': patch
'autotel-mcp-instrumentation': patch
'autotel-message-contract': patch
'autotel-mongoose': patch
'autotel-nuxt': patch
'autotel-pact': patch
'autotel-playwright': patch
'autotel-plugins': patch
'autotel-schema': patch
'autotel-sentry': patch
'autotel-subscribers': patch
'autotel-tanstack': patch
'autotel-telemetry': patch
'autotel-terminal': patch
'autotel-vitest': patch
'autotel-web': patch
---

Stop publishing source maps. Every package is roughly half the size it was.

Published output across all packages drops from 18.7 MiB to 7.9 MiB. Installing
`autotel` downloads 500 KiB gzipped instead of 1,130 KiB. Nothing about the
shipped JavaScript or type declarations changed.

Source maps were 55–65% of every package, because each source byte was emitted
four times: once as ESM, once as CJS, and again inside each format's map, which
embedded `sourcesContent`. They never reached a consumer's application bundle —
bundlers read maps and discard them — so the cost was pure install weight in
exchange for TypeScript stack traces under `node --enable-source-maps`.

Best-in-class TypeScript libraries do not make that trade. Of fourteen surveyed,
twelve publish no maps at all (zod, hono, pino, fastify, vitest, vite, rollup,
undici, commander, tsdown, react, astro), and not one publishes `.d.ts.map`.
The OpenTelemetry packages do ship maps at around 50% of their size, which is
the convention this repo had been following.

The `.d.ts.map` declaration maps were broken regardless: `sourcesContent: false`
with sources pointing at `../src/*.ts`, which `files` never published, so they
resolved to nothing on a consumer's machine.

Maps are still generated for local development. `tsconfig.json` keeps
`sourceMap` and `declarationMap` on; only `tsconfig.build.json` disables them,
so debugging the workspace is unchanged.

This also fixes the bundle-size gate, which had been amplifying every ordinary
change by 4×. The three packages that were failing it (`autotel-backends` +43.9%,
`autotel-mcp` +14.4%, `autotel-schema` +12.0%) were not bloated — that growth was
legitimate new backend code, quadrupled by the build. The baseline is
regenerated.
