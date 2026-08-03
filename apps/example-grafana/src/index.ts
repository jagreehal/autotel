/**
 * Carrier gateway — the service the dashboards and alert rules in ./grafana watch.
 *
 * Quotes shipments against two upstream carrier APIs. One of them starts
 * returning 401 partway through the run, which is the incident the alert rule
 * in grafana/provisioning/alerting.yml exists for.
 *
 * Run: pnpm start           (sends to http://localhost:4318 by default)
 */

import 'dotenv/config';
import {
  init,
  shutdown,
  Metric,
  type TraceContext,
  withTracing,
} from 'autotel';
import { createBuiltinLogger } from 'autotel/logger';
import { createGrafanaConfig } from 'autotel-backends/grafana';

const endpoint =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318';
const service = process.env.OTEL_SERVICE_NAME ?? 'carrier-gateway';

// How long the run stays healthy before the token refresh breaks, and how long
// it runs in total. Both exist so the alert can be watched firing in a minute
// rather than waited on.
const incidentAfterMs = Number(process.env.INCIDENT_AFTER_SECONDS ?? 90) * 1000;
const runForMs = Number(process.env.RUN_FOR_SECONDS ?? 600) * 1000;

const logger = createBuiltinLogger(service, { level: 'info', pretty: true });

init({
  ...createGrafanaConfig({
    endpoint,
    headers: process.env.OTEL_EXPORTER_OTLP_HEADERS || undefined,
    service,
    environment: process.env.NODE_ENV || 'development',
    enableLogs: true,
  }),
  // No top-level `logger` on purpose: init({ logger }) is also the fallback
  // for canonical log lines, which would send them to this console logger
  // instead of the OTel Logs API, and nothing would reach Loki.
  canonicalLogLines: { enabled: true },
});

// Metric names are the contract the alert rules are written against, so they
// are pinned here rather than derived from the service name. Renaming one of
// these is a breaking change for ./grafana.
const metrics = new Metric(service, {
  metrics: {
    outcomes: {
      name: 'carrier.requests',
      description: 'Carrier API requests by outcome',
    },
    value: {
      name: 'carrier.request.duration_ms',
      description: 'Carrier API request duration',
    },
  },
});

const CARRIERS = ['shipfast', 'northwind'] as const;
const startedAt = Date.now();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The failure being simulated: shipfast's OAuth token stops refreshing, so its
 * quotes come back 401 while northwind stays healthy. Alerting on a blended
 * error rate across both carriers would miss it, which is the argument for the
 * label being in the metric.
 */
function authFailureRate(carrier: string): number {
  const inIncident = Date.now() - startedAt > incidentAfterMs;
  return carrier === 'shipfast' && inIncident ? 0.65 : 0.005;
}

const quoteShipment = withTracing({ name: 'carrier.quote' })(
  (ctx: TraceContext) => async (carrier: string, weightKg: number) => {
    ctx.setAttribute('carrier.name', carrier);
    ctx.setAttribute('shipment.weight_kg', weightKg);

    const began = performance.now();
    await sleep(40 + Math.random() * 120);
    const durationMs = performance.now() - began;

    const roll = Math.random();
    const reason =
      roll < authFailureRate(carrier)
        ? 'auth'
        : roll > 0.98
          ? 'timeout'
          : undefined;

    metrics.trackValue('carrier.request.duration_ms', durationMs, { carrier });

    if (reason) {
      const httpStatus = reason === 'auth' ? 401 : 504;
      metrics.trackOutcome('carrier.quote', 'failure', {
        carrier,
        reason,
        http_status: httpStatus,
      });
      const err = new Error(`${carrier} quote failed (${httpStatus})`);
      ctx.setAttribute('http.response.status_code', httpStatus);
      ctx.setAttribute('error.reason', reason);
      ctx.recordError(err);
      ctx.setStatus({ code: 2, message: reason });
      logger.error({ carrier, reason, httpStatus }, 'Carrier quote failed');
      throw err;
    }

    metrics.trackOutcome('carrier.quote', 'success', { carrier });
    const price = Number((weightKg * 2.35 + 4.5).toFixed(2));
    ctx.setAttribute('quote.price_gbp', price);
    logger.info({ carrier, price, durationMs }, 'Carrier quote returned');
    return { carrier, price };
  },
);

async function main() {
  logger.info(
    { endpoint, service, incidentAfterMs, runForMs },
    'Sending telemetry; the alert in ./grafana fires once shipfast starts 401ing',
  );

  const deadline = Date.now() + runForMs;
  while (Date.now() < deadline) {
    const carrier = CARRIERS[Math.floor(Math.random() * CARRIERS.length)]!;
    try {
      await quoteShipment(carrier, Math.round(1 + Math.random() * 30));
    } catch {
      // Already recorded on the span and the counter; the loop is the caller
      // that would retry with the other carrier in a real gateway.
    }
    await sleep(200);
  }

  await shutdown();
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown().finally(() => process.exit(0));
  });
}

main().catch((err) => {
  logger.error({ err }, 'Fatal error');
  process.exit(1);
});
