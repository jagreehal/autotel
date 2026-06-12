# Security Observability

Record security-relevant behaviour with structured hooks and metrics. Emit
`security.*` events at decision points, derive signals from spans you already
have, and triage from the CLI. Alert rules live in your OTLP backend.

> **Scope**
>
> - Autotel exports traces, metrics, and structured events. It does not
>   authenticate, authorize, block, or page anyone.
> - You call the hooks at auth checks, tenant boundaries, and secret access.
>   Autotel writes `security.*` attributes and counters.
> - Alert rules and dashboards live in your OTLP backend (Prometheus, Datadog,
>   Loki, etc.).

OWASP A09:2025 (Security Logging & Alerting Failures) targets missing logs,
unclear messages, and weak alerting. Autotel exports structured,
redaction-safe, sampling-exempt security telemetry plus alertable metrics.

## The hooks

| Explicit (you call at decision points) | Passive (wire once) |
|---|---|
| `securityEvent()` / `withSecurity()` | `createSecuritySignalProcessor()` |
| `hashIdentifier()` | `startSecurityHeartbeat()` |
| `defineValidator()` + `onValidationMismatch()` | `init({ attributeRedactor })` |
| `withAudit()` (compliance trail) | `SecuritySubscriber` (routing) |

## The pieces

| Piece | Package | What it gives you |
|---|---|---|
| `securityEvent()` / `withSecurity()` | `autotel-audit` | Typed events, stable `security.*` schema, force-keep through tail sampling, credential-key guard, auto counter |
| `createSecuritySignalProcessor()` | `autotel-audit` | Zero-code signals from HTTP/LLM spans: probe detection, denied-response metrics, auth-failure bursts, token anomalies |
| `startSecurityHeartbeat()` | `autotel-audit` | `autotel.security.heartbeat` counter; alert on the *absence* of telemetry |
| `hashIdentifier()` | `autotel-audit` | Correlate emails/IPs across events without logging raw PII |
| `SecuritySubscriber` | `autotel-subscribers/security` | Forward `security.*` events to webhook/SIEM/pager, severity-gated |
| `autotel security summary` / `events` | `autotel-cli` | Incident triage from the terminal, JSON envelope output |
| Security lens | `autotel-devtools` | Live **Security** tab surfacing `security.*` spans during local development |

## Setup (one-time)

```typescript
import { init } from 'autotel';
import {
  createSecuritySignalProcessor,
  startSecurityHeartbeat,
} from 'autotel-audit';

init({
  service: 'api',
  spanProcessors: [createSecuritySignalProcessor()],
});

startSecurityHeartbeat();
```

Then emit events at your security decision points:

```typescript
import { securityEvent, hashIdentifier } from 'autotel-audit';

securityEvent({
  name: 'auth.login.failed',
  category: 'authentication',
  outcome: 'failure',
  severity: 'warning',
  actorId: hashIdentifier(email),
  reason: 'invalid_password',
});
```

## The metric schema

| Metric | Attributes | Source |
|---|---|---|
| `autotel.security.events` | `event`, `category`, `outcome`, `severity` | every `securityEvent()` |
| `autotel.security.http.denied` | `status` | 401/403/429 responses |
| `autotel.security.http.suspicious` | `pattern` | probe-path detection |
| `autotel.security.anomaly` | `signal`, (`status`) | bursts, LLM consumption |
| `autotel.security.heartbeat` | custom | liveness |

Span attributes: `security.event`, `security.category`, `security.outcome`,
`security.severity`, `security.actor_id`, `security.tenant_id`,
`security.reason`, `security.suspicious_request`, `security.signal`,
`autotel.security=true` (plus force-keep markers).

## Detection rules (starter pack)

OTLP metric names map to backend-specific forms; Prometheus renders
`autotel.security.events` as `autotel_security_events_total`.

### Prometheus / Grafana (PromQL)

```yaml
groups:
  - name: security-observability
    rules:
      # 1. Failed-login spike (tune threshold to your baseline)
      - alert: AuthFailureSpike
        expr: >
          sum(rate(autotel_security_events_total{
            event="auth.login.failed"}[5m])) > 1
        for: 5m
        labels: { severity: warning }
        annotations:
          summary: "Failed logins above baseline"

      # 2. Any critical security event
      - alert: CriticalSecurityEvent
        expr: >
          sum(increase(autotel_security_events_total{
            severity="critical"}[5m])) > 0
        labels: { severity: critical }

      # 3. Denied-response surge (credential stuffing / scraping)
      - alert: DeniedResponseSurge
        expr: >
          sum(rate(autotel_security_http_denied_total[5m]))
            > 4 * sum(rate(autotel_security_http_denied_total[1h] offset 1h))
        for: 10m
        labels: { severity: warning }

      # 4. Scanner / probe traffic detected
      - alert: SuspiciousRequestProbes
        expr: >
          sum by (pattern) (
            increase(autotel_security_http_suspicious_total[15m])) > 10
        labels: { severity: info }

      # 5. Auth-failure burst anomaly (pre-aggregated in-process)
      - alert: AuthFailureBurst
        expr: >
          sum(increase(autotel_security_anomaly_total{
            signal="auth_failure_burst"}[5m])) > 0
        labels: { severity: warning }

      # 6. LLM consumption anomaly (OWASP LLM10)
      - alert: LlmConsumptionAnomaly
        expr: >
          sum by (signal) (increase(autotel_security_anomaly_total{
            signal=~"llm_.*"}[15m])) > 0
        labels: { severity: warning }

      # 7. Alert when heartbeat stops (telemetry pipeline went dark)
      - alert: SecurityTelemetryAbsent
        expr: >
          absent(rate(autotel_security_heartbeat_total{
            service_name="api"}[5m]))
        for: 5m
        labels: { severity: critical }
        annotations:
          summary: "No security telemetry from api; pipeline dead or service compromised"
```

### Datadog (monitor queries)

```text
# Failed-login spike
sum(last_5m):sum:autotel.security.events{event:auth.login.failed}.as_rate() > 1

# Critical security event
sum(last_5m):sum:autotel.security.events{severity:critical}.as_count() > 0

# Telemetry absent (use a metric-absence monitor)
sum(last_10m):sum:autotel.security.heartbeat{service:api}.as_count() < 1
```

### Loki (LogQL, if you route logs there)

```text
# Security events with severity error+ in the canonical log line
{service_name="api"} | json | security_severity=~"error|critical"

# Tenant-boundary violations
{service_name="api"} | json | security_event="access.tenant.violation"
```

## Triage from the terminal

```bash
# What happened in the last hour?
autotel security summary --lookback-minutes 60

# Drill into critical events
autotel security events --severity critical --lookback-minutes 240

# Pivot to a full trace from a sampleTraceId
autotel trace summary <traceId>
```

`security summary` returns events by severity/category/outcome, top event
names, probe signals by pattern, denied responses by status with top
clients, and sample trace IDs for pivoting. Output is one JSON document on
stdout.

## Routing alerts without a backend

For teams without SIEM plumbing, `SecuritySubscriber` forwards events
directly:

```typescript
import { Events } from 'autotel/events';
import { SecuritySubscriber } from 'autotel-subscribers/security';

const events = new Events('api', {
  subscribers: [
    new SecuritySubscriber({
      webhookUrl: process.env.SECURITY_WEBHOOK_URL!,
      minSeverity: 'error',
    }),
  ],
});
```

## OWASP Top 10 mapping

You instrument the rows below at the relevant decision point. Autotel
standardizes the telemetry; your backend runs detection.

| OWASP 2025 | What Autotel makes visible |
|---|---|
| A01 Broken Access Control | `access.denied`, `access.tenant.violation` events; denied-response metrics |
| A03 Software Supply Chain | `dependency.scan.failed`, `config.changed` events (emit from CI/deploy hooks) |
| A05 Injection | `validation.failed` events; SQLi/XSS probe signals from the processor |
| A07 Auth Failures | `auth.*` events; auth-failure burst anomalies |
| A09 Logging & Alerting Failures | the whole feature set, plus the heartbeat for the meta-failure (logging silently stopped) |
| LLM01 Prompt Injection | `llm.prompt_injection.detected` events |
| LLM10 Unbounded Consumption | `llm_excessive_tokens` / `llm_token_budget_exceeded` signals |

## What NOT to log

The credential-key guard drops values under `token`/`apiKey`/`password`-shaped
keys automatically, but it is a backstop, not a license. Never put in event
metadata: secrets (hashed or not), session IDs, raw card/bank data, raw
prompts or retrieved context. Use `hashIdentifier()` for emails and IPs.
The core `AttributeRedactingProcessor` (presets: `default`, `strict`)
catches value-shaped PII as a second layer.

## Testing your security telemetry

In integration tests, assert that security paths emit the expected spans and
attributes:

```typescript
import { createTraceCollector } from 'autotel/testing';

const collector = createTraceCollector();
await attemptLoginWithBadPassword();
const span = collector.expectSpan({ 'security.event': 'auth.login.failed' });
expect(span.attributes['security.severity']).toBe('warning');
```

Periodically fire a synthetic probe (e.g. request `/.env` from a canary) to
verify the chain from signal through metric, alert, and on-call response.
