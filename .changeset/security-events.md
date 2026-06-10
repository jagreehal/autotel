---
'autotel-audit': minor
---

Add typed security events (OWASP A09-aligned): `securityEvent()`, `withSecurity()`, `hashIdentifier()`, and a zero-code `createSecuritySignalProcessor()`.

Security events emit a stable `security.*` attribute schema (`security.event`, `security.category`, `security.outcome`, `security.severity`), are exempt from tail sampling by default, never emit values under credential-shaped keys (reusing autotel core's `REDACTOR_PATTERNS.sensitiveKey`), and feed the `autotel.security.events` counter so security teams can alert on rates. `hashIdentifier()` provides stable one-way digests so PII-bearing identifiers (emails, IPs) can be correlated across events without being logged raw.

`createSecuritySignalProcessor()` derives security signals from existing HTTP spans with no per-route code: flags suspicious request paths (traversal, `.env`/`.git` probes, SQLi/XSS probes) and force-keeps them through tail sampling, counts denied responses (401/403/429) into `autotel.security.http.denied`, and detects per-client auth-failure bursts via a bounded sliding window (`autotel.security.anomaly` + `onSignal` callback).
