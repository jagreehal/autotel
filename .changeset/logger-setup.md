---
'autotel': major
'autotel-cli': minor
'autotel-devtools': minor
---

Logger setup and `autoInstrumentations` that do what they say.

**`autoInstrumentations: [...]` is an allowlist.** Only the names you list load. Add `'http'` for per-request server spans and the canonical log lines built on them, or pass `true` for every instrumentation. The object form keeps its meaning: `{ http: { enabled: false } }` loads everything except http. `init()` warns when a listed name loads nothing, such as a typo or `'fastify'`, which `@opentelemetry/auto-instrumentations-node` does not provide.

**Application loggers.** Give pino, winston or bunyan trace context with `autoInstrumentations` and create the logger in its own module after `init()`. The `logger` option carries autotel's own diagnostics only, and canonical log lines go to `canonicalLogLines.logger` or the OTel Logs API. Pino passed as `logger` now works, because autotel calls its methods on the logger.

**Startup warnings.** `init()` prints setup warnings to the console when you pass no `logger`, and respects `silent`. It warns when an ESM app starts without `--import autotel/register`, when a logger it instruments loaded before `init()`, and when `@opentelemetry/auto-instrumentations-node` is missing. ESM detection reads the entry file's extension first, so a `.cjs` entry in a `"type": "module"` package counts as CommonJS.

**Embedded devtools.** `devtools: { embedded: true }` binds the configured port and warns when it can't, so exporters and the server always agree on the port. `createDevtools` takes `maxPortTries` (default 20). Embedded mode needs a fixed `devtools.port`.

**`autotel init`.** The CLI lists every detected logger and library in `autoInstrumentations`, plus `'http'`, and auto-instruments pino like winston and bunyan.

**Docs and examples.** The pino, winston and bunyan examples, the Express and Fastify guides and the logging guide use this setup. Winston OTLP export needs `@opentelemetry/winston-transport`.
