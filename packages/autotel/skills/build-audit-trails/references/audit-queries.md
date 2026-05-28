# Querying the audit trail

Because audit events are OpenTelemetry spans, you query them with the same tools as the rest of your telemetry, no separate audit UI required. The attribute names below match the skill: `audit.action`, `audit.outcome`, `audit.resource.id`, `enduser.id`, `autotel.audit`, and `audit.signature.value`.

Run these against the **audit backend** (the append-only one), not your ops backend.

## Find all denials in a window

A spike in denials is a security signal (credential stuffing, privilege probing).

- **Honeycomb** — filter `autotel.audit = true` AND `audit.outcome = deny`, group by `audit.action` and `enduser.id`, visualize `COUNT`.
- **Grafana Tempo (TraceQL)**:
  ```
  { span.autotel.audit = true && span.audit.outcome = "deny" }
  ```
- **Datadog (spans search)**:
  ```
  @autotel.audit:true @audit.outcome:deny
  ```

## Trace one actor across every resource

Answer "everything user X did" for an access review or incident.

- **Honeycomb** — filter `enduser.id = "usr_42"`, group by `audit.action`, `audit.resource.type`, order by timestamp.
- **TraceQL**:
  ```
  { span.enduser.id = "usr_42" && span.autotel.audit = true }
  ```
- **Datadog**:
  ```
  @enduser.id:usr_42 @autotel.audit:true
  ```

## Who touched one resource

Answer "everyone who accessed secret `sec_abc`".

- **TraceQL**:
  ```
  { span.audit.resource.id = "sec_abc" && span.autotel.audit = true }
  ```
- **Datadog**:
  ```
  @audit.resource.id:sec_abc @autotel.audit:true
  ```

## Spot coverage gaps

Confirm sensitive actions are actually being recorded. Group audit spans by `audit.action` and compare against your list of auditable actions. An action that never appears is either never exercised or never audited; both deserve a look.

- **Honeycomb** — group by `audit.action`, `COUNT`, over 30 days.

## Detect tampering or missing signatures

In a shared-storage setup every audit span should carry `audit.signature.value`. Spans without one, or whose recomputed HMAC does not match, are suspect.

- **Find unsigned audit spans (TraceQL)**:
  ```
  { span.autotel.audit = true && span.audit.signature.value = nil }
  ```
- **Datadog**:
  ```
  @autotel.audit:true -@audit.signature.value:*
  ```

Verification itself happens in code: export the spans, recompute the HMAC over the sorted attribute set (excluding `audit.signature.value`), and flag mismatches. A scheduled job that does this and writes its own audit span (`action: 'audit.integrity.check'`) gives you meta-auditing.

## Tips

- Pin the time range explicitly; audit queries often span months, well past hot-storage windows.
- Export results to CSV/NDJSON for auditors who need evidence outside the observability tool.
- Keep these queries in version control next to the audit code so reviewers can reproduce them.
