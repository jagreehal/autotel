# Grafana + Autotel: dashboards and alarms that live in the repo

A service (`carrier-gateway`) that quotes shipments against two upstream
carrier APIs, and a [`grafana/`](./grafana) folder that owns how it is watched:
the dashboard, the alert rule, the threshold, the routing and the runbook.

The point of the example is the folder, not the service. Instrumenting code and
then configuring the alarm by hand in a console splits one decision across two
places: the team that can defend the threshold does not control it, and the
console has no diff, no review and no history. Grafana takes both as files, so
they can go in the repo with the code that makes them true.

```
apps/example-grafana/
├── src/index.ts     emits the telemetry
└── grafana/         owns what is watched, and what pages someone
```

## Run it

Start the local stack with this repo's dashboards and alarms mounted in:

```bash
docker compose -f grafana/lgtm.overlay.yml up -d
```

Then generate traffic. It runs healthy for 90 seconds, then one carrier's OAuth
token stops refreshing:

```bash
pnpm start
```

Watch it land:

- Dashboard: <http://localhost:3000/d/carrier-gateway>
- Alert rule: <http://localhost:3000/alerting/list> — `Carrier API auth
failures` goes Normal → Pending → Firing, for `carrier=shipfast` only

Roughly four minutes from `pnpm start` to Firing: 90s of healthy traffic, a 5m
rate window that has to fill, and `for: 2m` of sustained breach.

```bash
docker compose -f grafana/lgtm.overlay.yml down -v   # stop
```

| Env var                       | Default                 | Notes                                               |
| ----------------------------- | ----------------------- | --------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | Point at Grafana Cloud's OTLP gateway to send there |
| `OTEL_METRIC_EXPORT_INTERVAL` | `60000`                 | `5000` locally, so `rate()` has points to work with |
| `INCIDENT_AFTER_SECONDS`      | `90`                    | When the token stops refreshing                     |
| `RUN_FOR_SECONDS`             | `600`                   | How long to keep quoting                            |

## The metric the alarm is written against

```ts
metrics.trackOutcome('carrier.quote', 'failure', {
  carrier,
  reason: 'auth',
  http_status: 401,
});
```

reaches Prometheus as `carrier_requests_total{carrier, status, reason,
http_status}`, which the rule in
[`grafana/provisioning/alerting.yml`](./grafana/provisioning/alerting.yml)
reduces to a per-carrier ratio. The metric name is pinned explicitly in
`src/index.ts` rather than derived from the service name, because renaming it
silently breaks every query in `grafana/`.

The `carrier` label is what makes the alarm possible: with two carriers sharing
traffic, one failing every single request only moves a blended error rate to
about 50%, so a global threshold either misses it or screams at everything.

## Sending to Grafana Cloud

Two different APIs, two different credentials — the common cause of a silent
401:

| Use case                    | Base URL                                                   | Auth                                   | Where                                                                   |
| --------------------------- | ---------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------- |
| Sending traces/metrics/logs | OTLP gateway, `https://otlp-gateway-XXXX.grafana.net/otlp` | Instance ID + API token, as Basic auth | Cloud Portal → your stack → Connections → OpenTelemetry → **Configure** |
| Managing dashboards, alarms | `https://YOUR_STACK.grafana.net/api`                       | Service account token (`glsa_...`)     | Grafana → Administration → Service accounts                             |

A `glsa_...` token is **not** an OTLP credential. Copy the endpoint and headers
from the OpenTelemetry Configure tile into `.env`:

```bash
cp .env.example .env
pnpm start
```

Then apply `grafana/` to the stack with Git Sync, `grizzly apply` or Terraform —
see [`grafana/README.md`](./grafana/README.md#applying-it-to-a-real-grafana).
Only the datasource UID and the contact point URL differ per environment.

## How the telemetry gets there

- **Traces** (Tempo) and **metrics** (Mimir): `createGrafanaConfig()` from
  `autotel-backends/grafana` wires the OTLP exporters from one endpoint and
  header pair.
- **Logs** (Loki): `canonicalLogLines: { enabled: true }` emits one log record
  per completed span through the OTel Logs API, carrying the trace id — which
  is what makes the dashboard's log panel clickable through to the trace.
  Note that `init({ logger })` also becomes the sink for canonical log lines,
  so this example deliberately does not pass one; otherwise the lines go to the
  console and Loki stays empty.

## Learn more

- [Grafana Cloud: send OTLP data](https://grafana.com/docs/grafana-cloud/send-data/otlp/send-data-otlp/)
- [Grafana: provision alerting resources](https://grafana.com/docs/grafana/latest/alerting/set-up/provision-alerting-resources/)
- [Autotel documentation](https://github.com/jagreehal/autotel)
