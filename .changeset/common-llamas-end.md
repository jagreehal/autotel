---
'autotel-subscribers': minor
'autotel-cloudflare': minor
'autotel-backends': minor
'autotel-tanstack': minor
'autotel-terminal': minor
'autotel-plugins': minor
'autotel-edge': minor
'autotel-aws': minor
'autotel-cli': minor
'autotel-mcp': minor
'autotel-web': minor
'autotel': minor
---

- **autotel-sentry**: README updates — clarify Sentry SDK + OTel scenario, link to Sentry OTLP docs, note that Sentry ingestion request spans are not sent, fix `SentrySpanProcessor` backtick typo, add spec-volatility note.
- **autotel-backends**: Preserve caught error in Google Cloud config — attach original error as `cause` when throwing the user-facing error so the `preserve-caught-error` lint rule is satisfied.
