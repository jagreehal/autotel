# Grafana Cloud + Autotel Example

This example sends **traces** (Tempo), **metrics** (Mimir), and **logs** (OTLP → Loki) to Grafana Cloud using only **autotel** and **autotel-backends** (no direct OpenTelemetry imports in app code).

## Two Different APIs / Credentials

| Use case | Base URL | Auth | Where to get credentials |
|----------|----------|------|---------------------------|
| **Sending data** (traces, metrics, logs) | OTLP gateway (e.g. `https://otlp-gateway-XXXX.grafana.net/otlp`) | Instance ID + API token (e.g. `Authorization: Basic ...`) | Grafana Cloud Portal → your stack → **Connections** → **OpenTelemetry** → **Configure** → copy env vars |
| **Managing Grafana** (dashboards, folders, health, search) | `https://YOUR_STACK.grafana.net/api` | Service account token (e.g. `glsa_...`) | Grafana → Administration → Service accounts → Create token |

**Important:** A Grafana API token (e.g. `glsa_...`) is for the **stack HTTP API** (dashboards, health, search). It is **not** used for OTLP ingestion. To send traces, metrics, and logs, you must get the **OTLP endpoint and headers** from the OpenTelemetry **Configure** tile in the Cloud Portal.

### Get OTLP credentials (required for sending data)

1. Sign in to [Grafana Cloud](https://grafana.com/auth/sign-in/).
2. Open your **stack** (e.g. grafanajagreehal).
3. Go to **Connections** (or **Add new connection**), then find **OpenTelemetry**.
4. Click **Configure** on the OpenTelemetry tile.
5. Copy the script or env vars shown there. You will get:
   - **OTEL_EXPORTER_OTLP_ENDPOINT**: your stack’s OTLP gateway URL (not the generic `otlp-gateway-prod-*` unless it’s for your stack).
   - **OTEL_EXPORTER_OTLP_HEADERS**: usually `Authorization=Basic <base64(instanceId:apiToken)>` (Instance ID and token from that page).

Use those values in `.env`. Without them, the app runs but export will return 401 and data will not appear in Grafana.

## Prerequisites

1. **Grafana Cloud**: A stack with OpenTelemetry (OTLP) enabled
2. **Node.js** 18+ and pnpm

## Quick Start

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment variables

Copy the example env file and add your Grafana Cloud OTLP credentials:

```bash
cp .env.example .env
```

Edit `.env`:

- **OTEL_EXPORTER_OTLP_ENDPOINT**: From Grafana Cloud: Stack → Connections → OpenTelemetry → Configure (e.g. `https://otlp-gateway-XXXX.grafana.net/otlp`)
- **OTEL_EXPORTER_OTLP_HEADERS**: From the same Configure tile (e.g. `Authorization=Basic <base64(instanceId:apiToken)>`)

### 3. Run the example

```bash
pnpm start
```

The app will run a short demo (create user, process payment, create order), sending traces, metrics, and logs to Grafana Cloud, then exit.

### 4. View in Grafana

- **Traces:** Explore → Tempo (or Application Observability)
- **Metrics:** Explore → Prometheus/Mimir
- **Logs:** Explore → Loki (filter e.g. by `service_name="example-grafana"`)

## Verify Grafana API (stack management)

If you have a **Grafana API token** (service account token for the stack), you can call the Grafana HTTP API (dashboards, folders, health, etc.). This is separate from OTLP ingestion.

Example (replace `YOUR_STACK` and use your token):

```bash
# Health check
curl -H "Authorization: Bearer $GRAFANA_API_TOKEN" \
  https://YOUR_STACK.grafana.net/api/health

# Search dashboards
curl -H "Authorization: Bearer $GRAFANA_API_TOKEN" \
  "https://YOUR_STACK.grafana.net/api/search?query="
```

See [Grafana HTTP API](https://grafana.com/docs/grafana/latest/developers/http_api/) for more endpoints.

## How it works

- **Traces:** `createGrafanaConfig()` from `autotel-backends/grafana` returns config with `endpoint` and `headers`; autotel’s default OTLP trace exporter sends to the Grafana Cloud OTLP gateway → Tempo.
- **Metrics:** Same endpoint and headers; the preset sets `metrics: true` → Mimir.
- **Logs:** The app uses `createBuiltinLogger()` from `autotel/logger` and passes `logger` plus `canonicalLogLines: { enabled: true }` into `init()`. Canonical log lines (one per span completion) are emitted to the OpenTelemetry Logs API and exported via the preset’s `logRecordProcessors` (OTLPLogExporter) → Loki. Application `logger.info()` / `logger.warn()` / etc. go to the console; span summaries are sent to Loki. Log libs are bundled in `autotel-backends`; no app-level install needed.

## Learn more

- [Grafana Cloud: Send OTLP data](https://grafana.com/docs/grafana-cloud/send-data/otlp/send-data-otlp/)
- [Autotel documentation](https://github.com/jagreehal/autotel)
