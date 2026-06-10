---
'autotel-subscribers': minor
'autotel-cli': minor
---

Security alerting and triage tooling.

**autotel-subscribers**: new `SecuritySubscriber` (`autotel-subscribers/security`) — forwards `security.*` events from the Events pipeline to a webhook/SIEM or custom handler, gated by `minSeverity`, with normalized `SecurityAlert` payloads carrying severity/category/outcome/reason and trace correlation. Webhook delivery uses the same hardened pipeline as `WebhookSubscriber` (timeout-bounded requests, classified errors, exponential-backoff retries via `maxRetries`/`timeoutMs`/`retryDelayMs`).

**autotel-cli**: new `autotel security` command group. `security summary` aggregates security events (by severity/category/outcome, top events), suspicious-request signals, and denied responses (401/403/429, top clients) over a time window; `security events` lists spans carrying the `security.*` schema with `--category`/`--severity` filters. Both emit the standard `{ ok, command, data }` JSON envelope on any supported backend.
