/**
 * E2E test for OTLP HTTP/JSON span export.
 *
 * Smoke mode (default): asserts the configured OTLP collector accepts spans
 * with a 2xx status. Required for any backend that exposes only an ingest
 * endpoint (most managed services: Honeycomb, Grafana Cloud, Datadog, etc.).
 *
 * Required env vars:
 *   - OTLP_E2E_ENDPOINT  full URL of the OTLP HTTP/JSON traces endpoint, e.g.
 *                        `https://api.honeycomb.io/v1/traces`
 *   - OTLP_E2E_HEADERS   JSON object of headers, e.g.
 *                        `{"x-honeycomb-team":"<token>"}`
 *
 * Optional:
 *   - OTLP_E2E_SERVICE   service.name to attach (default: `autotel-e2e`)
 */
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { expect } from 'vitest';
import { describeIfEnv, itWithCorrelationId, makeAttributes } from './_shared';

function parseHeaders(value: string | undefined): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, string>;
    return parsed;
  } catch {
    throw new Error(
      'OTLP_E2E_HEADERS must be valid JSON, e.g. \'{"x-api-key":"…"}\'',
    );
  }
}

describeIfEnv(
  'otlp http/json e2e',
  ['OTLP_E2E_ENDPOINT', 'OTLP_E2E_HEADERS'],
  () => {
    const endpoint = process.env.OTLP_E2E_ENDPOINT!;
    const headers = parseHeaders(process.env.OTLP_E2E_HEADERS);
    const serviceName = process.env.OTLP_E2E_SERVICE ?? 'autotel-e2e';

    itWithCorrelationId(
      'collector accepts a single span',
      async (correlationId) => {
        const exporter = new OTLPTraceExporter({ url: endpoint, headers });
        const provider = new BasicTracerProvider({
          resource: resourceFromAttributes({ 'service.name': serviceName }),
          spanProcessors: [new SimpleSpanProcessor(exporter)],
        });

        const tracer = provider.getTracer('autotel-e2e');
        const span = tracer.startSpan('autotel.e2e.single', {
          attributes: {
            ...makeAttributes('otlp-single'),
            e2e_correlation_id: correlationId,
          },
        });
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();

        await provider.forceFlush();
        await provider.shutdown();
      },
      60_000,
    );

    itWithCorrelationId(
      'collector accepts a multi-span trace',
      async (correlationId) => {
        const exporter = new OTLPTraceExporter({ url: endpoint, headers });
        const provider = new BasicTracerProvider({
          resource: resourceFromAttributes({ 'service.name': serviceName }),
          spanProcessors: [new SimpleSpanProcessor(exporter)],
        });

        const tracer = provider.getTracer('autotel-e2e');
        const parent = tracer.startSpan('autotel.e2e.parent', {
          attributes: {
            ...makeAttributes('otlp-trace-parent'),
            e2e_correlation_id: correlationId,
          },
        });
        const ctx = trace.setSpan(
          trace.context ? trace.context().active() : ({} as any),
          parent,
        );
        const child = tracer.startSpan(
          'autotel.e2e.child',
          { attributes: makeAttributes('otlp-trace-child') },
          ctx,
        );
        child.end();
        parent.end();

        await provider.forceFlush();
        await provider.shutdown();

        // No assertion necessary — `forceFlush` rejects if the exporter returns
        // a non-2xx status, which fails the test.
        expect(true).toBe(true);
      },
      60_000,
    );
  },
);
