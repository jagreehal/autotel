/**
 * PushMetricExporter that ships OTLP/JSON metrics to the CloudWatch
 * metrics endpoint (https://monitoring.<region>.amazonaws.com/v1/metrics)
 * using SigV4.
 *
 * Lands in: CloudWatch Metrics — queryable via PromQL alongside the AWS
 * vended namespaces.
 */

import type { ExportResult } from '@opentelemetry/core';
import { ExportResultCode } from '@opentelemetry/core';
import { JsonMetricsSerializer } from '@opentelemetry/otlp-transformer';
import {
  AggregationTemporality,
  type AggregationTemporalitySelector,
  type InstrumentType,
  type PushMetricExporter,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';

import { cloudWatchMetricsEndpoint } from './endpoints';
import {
  signCloudWatchOtlpRequest,
  type AwsCredentialsProvider,
} from './sigv4';

export interface CloudWatchMetricExporterConfig {
  region?: string;
  endpoint?: string;
  credentials?: AwsCredentialsProvider;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /**
   * Aggregation temporality. CloudWatch's OTLP metrics endpoint accepts
   * delta and cumulative; delta is generally cheaper for counters.
   */
  temporalitySelector?: AggregationTemporalitySelector;
}

const DEFAULT_TEMPORALITY: AggregationTemporalitySelector = (
  _instrumentType: InstrumentType,
) => AggregationTemporality.DELTA;

export class CloudWatchMetricExporter implements PushMetricExporter {
  private readonly region: string;
  private readonly endpoint: string;
  private readonly credentials?: AwsCredentialsProvider;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly temporalitySelector: AggregationTemporalitySelector;
  private shutdownOnce = false;

  constructor(config: CloudWatchMetricExporterConfig = {}) {
    const region = config.region ?? process.env.AWS_REGION;
    if (!region) {
      throw new Error(
        'CloudWatchMetricExporter: `region` is required (pass it explicitly or set AWS_REGION).',
      );
    }
    this.region = region;
    this.endpoint = config.endpoint ?? cloudWatchMetricsEndpoint({ region });
    this.credentials = config.credentials;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    this.temporalitySelector =
      config.temporalitySelector ?? DEFAULT_TEMPORALITY;
    if (typeof this.fetchImpl !== 'function') {
      throw new TypeError(
        'CloudWatchMetricExporter: global `fetch` is not available — pass `fetchImpl` explicitly.',
      );
    }
  }

  export(
    metrics: ResourceMetrics,
    resultCallback: (result: ExportResult) => void,
  ): void {
    if (this.shutdownOnce) {
      resultCallback({
        code: ExportResultCode.FAILED,
        error: new Error('CloudWatchMetricExporter: already shut down'),
      });
      return;
    }

    this.sendBatch(metrics).then(
      () => resultCallback({ code: ExportResultCode.SUCCESS }),
      (error: unknown) =>
        resultCallback({
          code: ExportResultCode.FAILED,
          error: error instanceof Error ? error : new Error(String(error)),
        }),
    );
  }

  async shutdown(): Promise<void> {
    this.shutdownOnce = true;
  }

  async forceFlush(): Promise<void> {}

  selectAggregationTemporality(
    instrumentType: InstrumentType,
  ): AggregationTemporality {
    return this.temporalitySelector(instrumentType);
  }

  private async sendBatch(metrics: ResourceMetrics): Promise<void> {
    const body = JsonMetricsSerializer.serializeRequest(metrics);
    if (!body) {
      throw new Error('CloudWatchMetricExporter: serializer produced no body');
    }

    const headers = await signCloudWatchOtlpRequest({
      url: this.endpoint,
      body,
      region: this.region,
      signal: 'metrics',
      credentials: this.credentials,
      contentType: 'application/json',
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const text = await safeReadText(response);
      throw new Error(
        `CloudWatchMetricExporter: HTTP ${response.status} ${response.statusText} ${text}`.trim(),
      );
    }
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
