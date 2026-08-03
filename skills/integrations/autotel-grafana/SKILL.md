---
name: autotel-grafana
description: >
  Keeps a service's Grafana dashboards and alert rules in the repo that owns
  the code, as provisioning files the team reviews in a pull request. Covers
  the `grafana/` folder layout, dashboard JSON, alert rule YAML (query →
  reduce → threshold), contact points and notification policies, running the
  local LGTM stack with those files mounted to prove an alarm fires, and using
  the Grafana MCP server and grafana/skills without recreating console drift.
  Use this skill when asked to add a dashboard or alert for an
  autotel-instrumented service, to move monitors out of a vendor console into
  code, to review an alert rule, or when someone says "dashboard as code",
  "alerting as code", "provisioning", "Git Sync", "grizzly" or "the alarm
  should live with the service" — even if Grafana is never named. Do not use
  for choosing the metric and its labels first — use skill
  `design-alertable-metrics`; for wiring the exporter to Grafana Cloud — use
  skill `autotel-backends`.
---

# autotel-grafana

Grafana takes dashboards, alert rules, contact points and notification
policies as plain files. That is what lets the alarm live in the repo it
belongs to, reviewed in the same pull request as the change that moves its
threshold.

Working reference: `apps/example-grafana` in the autotel repo — a service, a
`grafana/` folder, and an incident that makes the alarm fire.

## When to use

- Adding a dashboard or an alarm for a service you have instrumented
- Moving monitors out of a console and into the repo
- Reviewing a threshold, a routing rule or a runbook link
- Proving an alarm fires before it reaches production

## Critical rules

- **Get the metric right first.** The alarm can only group by attributes the
  code emits. See [`design-alertable-metrics`](../../core/design-alertable-metrics/SKILL.md).
- **Read through MCP, write to files.** The Grafana MCP server can create
  dashboards and rules directly in a live instance — that is console drift
  again, only automated. Use its read tools to discover which metrics and
  labels exist, then write the repo folder and let CI apply it.
- **Two values are environment-specific**, never repo-owned: the
  **datasource UID** in the alert rule, and the **contact point URL**.
  Substitute them at apply time and say so in a comment.
- **Provisioned dashboards are read-only in the UI.** That is the point, and
  it needs agreeing up front — a team that disagrees quietly stops
  provisioning. Explore in an unprovisioned copy; the committed file wins.
- **An alarm that has never fired is a guess.** Run the local loop below
  before opening the PR.

## Folder layout

```
grafana/
├── dashboards/<service>.json          what we look at
├── provisioning/alerting.yml          rules, thresholds, contact points, routing
├── provisioning/dashboards.yml        where Grafana finds the dashboards
├── lgtm.overlay.yml                   run it locally
└── README.md                          the runbook the alert links to
```

## Alert rule

Grafana rules are a small pipeline, not a single expression: a datasource query,
a reducer that turns the series into one number, and a threshold. `condition`
names the node that decides.

```yaml
apiVersion: 1

groups:
  - orgId: 1
    name: carrier-gateway
    folder: carrier-gateway
    interval: 1m
    rules:
      - uid: carrier-auth-failures
        title: Carrier API auth failures
        condition: C
        for: 2m
        labels:
          severity: critical
          team: logistics
        annotations:
          summary: '{{ $labels.carrier }} is rejecting our requests with 401'
          description: >-
            Auth failure ratio is {{ humanizePercentage $values.B.Value }} over 5 minutes.
          runbook_url: https://github.com/org/repo/blob/main/grafana/README.md#carrier-api-auth-failures
        noDataState: NoData
        execErrState: Error
        data:
          - refId: A
            relativeTimeRange: { from: 600, to: 0 }
            datasourceUid: prometheus # environment-specific
            model:
              refId: A
              editorMode: code
              range: true
              expr: >-
                sum by (carrier) (rate(carrier_requests_total{status="failure", reason="auth"}[5m]))
                /
                sum by (carrier) (rate(carrier_requests_total[5m]))
          - refId: B
            datasourceUid: __expr__
            model: { refId: B, type: reduce, reducer: last, expression: A }
          - refId: C
            datasourceUid: __expr__
            model:
              refId: C
              type: threshold
              expression: B
              conditions:
                - evaluator: { type: gt, params: [0.05] }
```

Grouping the query by a label produces **one alert instance per label value**,
so a healthy partition never fires. `noDataState: NoData` rather than `OK`:
sending no traffic to a dependency is not evidence that it is healthy.

Contact points and routing go in the same file. Provisioning replaces the whole
root policy, so restate the default receiver rather than only the branch you
care about:

```yaml
contactPoints:
  - orgId: 1
    name: logistics-oncall
    receivers:
      - uid: logistics-webhook
        type: webhook
        settings:
          url: https://example.com/hook # environment-specific
          httpMethod: POST

policies:
  - orgId: 1
    receiver: grafana-default-email
    group_by: [grafana_folder, alertname, carrier]
    routes:
      - receiver: logistics-oncall
        object_matchers: [['team', '=', 'logistics']]
        group_wait: 30s
        repeat_interval: 4h
```

## Dashboard

Keep `uid` stable — it is the URL runbooks and incident notes link to. Reference
datasources through a template variable so the same JSON works in every
instance, and default it to the local stack's UID:

```json
{
  "uid": "carrier-gateway",
  "editable": false,
  "templating": {
    "list": [
      {
        "name": "metrics",
        "type": "datasource",
        "query": "prometheus",
        "current": { "text": "Prometheus", "value": "prometheus" }
      }
    ]
  },
  "panels": [
    {
      "type": "timeseries",
      "datasource": { "type": "prometheus", "uid": "${metrics}" },
      "targets": [{ "refId": "A", "editorMode": "code", "expr": "..." }]
    }
  ]
}
```

Hand-writing this JSON is unpleasant. Two workflows survive: build it in the UI
and export, or let an agent write it against the schema. Either way the file is
the source of truth.

## Prove it fires locally

`grafana/lgtm.overlay.yml` runs the shared LGTM stack with the repo's folder
mounted in. `include` keeps the shared compose file untouched, and paths resolve
relative to the overlay:

```yaml
name: autotel-lgtm

include:
  - ../../../docker/lgtm.yml

services:
  lgtm:
    volumes:
      - ./dashboards:/repo/dashboards:ro
      - ./provisioning/dashboards.yml:/otel-lgtm/grafana/conf/provisioning/dashboards/<service>.yml:ro
      - ./provisioning/alerting.yml:/otel-lgtm/grafana/conf/provisioning/alerting/<service>.yml:ro
```

```bash
docker compose -f grafana/lgtm.overlay.yml up -d     # needs Compose v2.20+
OTEL_METRIC_EXPORT_INTERVAL=5000 pnpm start          # reproduce the failure

# Did the files load?
curl -s -u admin:admin localhost:3000/api/v1/provisioning/alert-rules | jq '.[].title'

# Did it fire, and only for the broken partition?
curl -s -u admin:admin localhost:3000/api/prometheus/grafana/api/v1/rules \
  | jq '.data.groups[].rules[] | {name, state, alerts: [.alerts[] | {labels, state}]}'
```

Expect `Normal` → `Pending` → `Firing`. Allow for the rate window plus `for:`
before judging it broken.

## Applying it to a real Grafana

| Where         | How                                                               |
| ------------- | ----------------------------------------------------------------- |
| Local / OSS   | Mount into `conf/provisioning`                                    |
| Grafana Cloud | Git Sync pointed at the folder, `grizzly apply`, or Terraform     |
| Kubernetes    | Grafana Operator `GrafanaDashboard` / `GrafanaAlertRuleGroup` CRs |

Scope the credential to the team's folder, so a bad merge in one repo cannot
delete another team's alarms.

## Agent tooling

Grafana ships an [MCP server](https://grafana.com/docs/grafana/latest/developer-resources/mcp/)
and a [skills marketplace](https://github.com/grafana/skills):

```bash
claude plugin marketplace add grafana/skills
claude plugin install grafana-core@grafana-skills    # dashboarding, alerting-irm, promql
claude plugin install grafana-cloud@grafana-skills   # prometheus-label-strategy, assistant-mcp
```

Prefer Grafana Cloud's hosted MCP, which authorises the signed-in user, over a
service account token pasted into a config file. If a token is unavoidable,
read it from the environment and scope it to one folder.

## Gotchas

- **`init({ logger })` also becomes the sink for canonical log lines**, sending
  them to that logger instead of the OTel Logs API — Loki stays empty and the
  log panel shows nothing. Omit it when you want the lines exported.
- **Metric names are rewritten in transit.** `carrier.requests` is
  `carrier_requests_total` in Prometheus. Query the backend for the real name
  before writing a panel or rule against it.
- **A short run exports metrics once, at shutdown.** `rate()` over one point
  returns nothing. Set `OTEL_METRIC_EXPORT_INTERVAL=5000` when verifying.
- **Grafana Cloud OTLP credentials are not the stack API token.** A `glsa_`
  token manages dashboards; ingestion uses the endpoint and Basic auth header
  from the OpenTelemetry Configure tile. See
  [`autotel-backends`](../autotel-backends/SKILL.md).

## Related skills

- [`design-alertable-metrics`](../../core/design-alertable-metrics/SKILL.md) — the labels that make the rule possible
- [`autotel-backends`](../autotel-backends/SKILL.md) — `createGrafanaConfig()` and the other vendor presets
- [`analyze-traces`](../../core/analyze-traces/SKILL.md) — querying what you sent, once it is there
