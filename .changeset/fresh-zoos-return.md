---
'autotel-cli': minor
'autotel': patch
---

Add logger instrumentation validation to `autotel doctor` command and update documentation for Winston/Bunyan setup.

**autotel-cli:**
- Add logger instrumentation check to `autotel doctor` that validates Winston, Bunyan, and Pino instrumentation packages are installed when configured
- Parse source code to detect `autoInstrumentations` configuration and warn if instrumentation packages are missing
- Add `logger-checker` utility to extract and validate logger instrumentation setup

**autotel:**
- Update README to clarify that Winston and Bunyan instrumentation packages must be installed separately, even though they're included in `@opentelemetry/auto-instrumentations-node`
- Fix misleading "auto-detects" claims - all loggers require explicit `autoInstrumentations` configuration
- Update Pino, Winston, and Bunyan examples to show correct setup with `autoInstrumentations` array
