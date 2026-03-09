---
"autotel": minor
"autotel-web": minor
"autotel-subscribers": minor
---

Add PII redaction to all PostHog export paths. Two-layer approach: regex value scanning
for emails, phones, credit cards, JWTs in error messages and stack traces, plus slow-redact
path-based redaction for known sensitive fields in structured event attributes.

- Extract `createStringRedactor()` utility from core `AttributeRedactingProcessor`
- Add `RedactingLogRecordProcessor` wrapper for PostHog OTLP logs
- Add redactor support to `posthog-error-formatter` (exception.value, abs_path)
- Add `redactPaths` and `stringRedactor` options to `PostHogSubscriber`
- Duplicate string redactor in `autotel-web` for browser error tracking
- Wire `attributeRedactor` from `init()` through to all PostHog paths automatically
