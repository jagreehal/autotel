/**
 * SpanExporter that ships OTLP/JSON straight to the CloudWatch traces
 * endpoint (https://xray.<region>.amazonaws.com/v1/traces) using SigV4.
 *
 * No collector required. Useful in Lambda when you don't want to attach
 * the ADOT extension layer, or any other env where you'd rather not run
 * a sidecar.
 *
 * Lands in: X-Ray + Application Signals + Transaction Search.
 */

import type { ExportResult } from '@opentelemetry/core';
import { ExportResultCode } from '@opentelemetry/core';
import { JsonTraceSerializer } from '@opentelemetry/otlp-transformer';
import type {
  ReadableSpan,
  SpanExporter,
} from '@opentelemetry/sdk-trace-base';

import { cloudWatchTracesEndpoint } from './endpoints';
import {
  signCloudWatchOtlpRequest,
  type AwsCredentialsProvider,
} from './sigv4';

export interface CloudWatchTraceExporterConfig {
  /** AWS region — defaults to `process.env.AWS_REGION`. */
  region?: string;
  /** Override the endpoint (mainly for tests / VPC endpoints). */
  endpoint?: string;
  /** Static credentials or a provider. Defaults to the AWS SDK default chain. */
  credentials?: AwsCredentialsProvider;
  /** Per-export timeout in ms. Defaults to 10s (CloudWatch's documented soft cap). */
  timeoutMs?: number;
  /** Optional `fetch` override (Node 18+ has it globally; useful in tests). */
  fetchImpl?: typeof fetch;
}

/**
 * OTLP/JSON exporter for CloudWatch's traces endpoint.
 *
 * Use with `BatchSpanProcessor` or `SimpleSpanProcessor` from
 * `@opentelemetry/sdk-trace-base`. For Lambda, `SimpleSpanProcessor`
 * (synchronous export per span) is fine for small workloads;
 * `BatchSpanProcessor` is better for higher-throughput functions but
 * needs `forceFlush()` before the handler returns.
 */
export class CloudWatchTraceExporter implements SpanExporter {
  private readonly region: string;
  private readonly endpoint: string;
  private readonly credentials?: AwsCredentialsProvider;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private shutdownOnce = false;

  constructor(config: CloudWatchTraceExporterConfig = {}) {
    const region = config.region ?? process.env.AWS_REGION;
    if (!region) {
      throw new Error(
        'CloudWatchTraceExporter: `region` is required (pass it explicitly or set AWS_REGION).',
      );
    }
    this.region = region;
    this.endpoint = config.endpoint ?? cloudWatchTracesEndpoint({ region });
    this.credentials = config.credentials;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new TypeError(
        'CloudWatchTraceExporter: global `fetch` is not available — pass `fetchImpl` explicitly (Node 18+ has it natively).',
      );
    }
  }

  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    if (this.shutdownOnce) {
      resultCallback({
        code: ExportResultCode.FAILED,
        error: new Error('CloudWatchTraceExporter: already shut down'),
      });
      return;
    }
    if (spans.length === 0) {
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }

    this.sendBatch(spans).then(
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

  async forceFlush(): Promise<void> {
    // Batching is the responsibility of the span processor. Nothing to flush here.
  }

  private async sendBatch(spans: ReadableSpan[]): Promise<void> {
    const body = JsonTraceSerializer.serializeRequest(spans);
    if (!body) {
      throw new Error('CloudWatchTraceExporter: serializer produced no body');
    }

    const headers = await signCloudWatchOtlpRequest({
      url: this.endpoint,
      body,
      region: this.region,
      signal: 'traces',
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
        `CloudWatchTraceExporter: HTTP ${response.status} ${response.statusText} ${text}`.trim(),
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
