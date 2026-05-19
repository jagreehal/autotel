/**
 * LogRecordExporter that ships OTLP/JSON logs to the CloudWatch logs
 * endpoint (https://logs.<region>.amazonaws.com/v1/logs) using SigV4.
 *
 * CloudWatch Logs requires `x-aws-log-group` and `x-aws-log-stream`
 * headers — both must already exist (this exporter does NOT create them).
 *
 * In Lambda, the runtime auto-provisions a log group + stream per function;
 * read them from `AWS_LAMBDA_LOG_GROUP_NAME` / `AWS_LAMBDA_LOG_STREAM_NAME`
 * (set automatically when the function runs).
 */

import type { ExportResult } from '@opentelemetry/core';
import { ExportResultCode } from '@opentelemetry/core';
import { JsonLogsSerializer } from '@opentelemetry/otlp-transformer';
import type {
  LogRecordExporter,
  ReadableLogRecord,
} from '@opentelemetry/sdk-logs';

import { cloudWatchLogsEndpoint } from './endpoints';
import {
  signCloudWatchOtlpRequest,
  type AwsCredentialsProvider,
} from './sigv4';

export interface CloudWatchLogExporterConfig {
  region?: string;
  endpoint?: string;
  credentials?: AwsCredentialsProvider;
  /**
   * Existing CloudWatch log group to write into. Defaults to
   * `AWS_LAMBDA_LOG_GROUP_NAME` (set automatically by the Lambda runtime).
   */
  logGroup?: string;
  /**
   * Existing CloudWatch log stream. Defaults to
   * `AWS_LAMBDA_LOG_STREAM_NAME`.
   */
  logStream?: string;
  /**
   * Optional comma-separated list of field paths CloudWatch may truncate
   * if the event exceeds 1 MB (sent as `x-aws-truncatable-fields`).
   */
  truncatableFields?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class CloudWatchLogExporter implements LogRecordExporter {
  private readonly region: string;
  private readonly endpoint: string;
  private readonly credentials?: AwsCredentialsProvider;
  private readonly logGroup: string;
  private readonly logStream: string;
  private readonly truncatableFields?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private shutdownOnce = false;

  constructor(config: CloudWatchLogExporterConfig = {}) {
    const region = config.region ?? process.env.AWS_REGION;
    if (!region) {
      throw new Error(
        'CloudWatchLogExporter: `region` is required (pass it explicitly or set AWS_REGION).',
      );
    }
    const logGroup = config.logGroup ?? process.env.AWS_LAMBDA_LOG_GROUP_NAME;
    const logStream = config.logStream ?? process.env.AWS_LAMBDA_LOG_STREAM_NAME;
    if (!logGroup || !logStream) {
      throw new Error(
        'CloudWatchLogExporter: `logGroup` and `logStream` are required ' +
          '(in Lambda they come from AWS_LAMBDA_LOG_GROUP_NAME / AWS_LAMBDA_LOG_STREAM_NAME).',
      );
    }
    this.region = region;
    this.endpoint = config.endpoint ?? cloudWatchLogsEndpoint({ region });
    this.credentials = config.credentials;
    this.logGroup = logGroup;
    this.logStream = logStream;
    this.truncatableFields = config.truncatableFields;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new TypeError(
        'CloudWatchLogExporter: global `fetch` is not available — pass `fetchImpl` explicitly.',
      );
    }
  }

  export(
    logs: ReadableLogRecord[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    if (this.shutdownOnce) {
      resultCallback({
        code: ExportResultCode.FAILED,
        error: new Error('CloudWatchLogExporter: already shut down'),
      });
      return;
    }
    if (logs.length === 0) {
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }

    this.sendBatch(logs).then(
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

  private async sendBatch(logs: ReadableLogRecord[]): Promise<void> {
    const body = JsonLogsSerializer.serializeRequest(logs);
    if (!body) {
      throw new Error('CloudWatchLogExporter: serializer produced no body');
    }

    const additionalHeaders: Record<string, string> = {
      'x-aws-log-group': this.logGroup,
      'x-aws-log-stream': this.logStream,
    };
    if (this.truncatableFields) {
      additionalHeaders['x-aws-truncatable-fields'] = this.truncatableFields;
    }

    const headers = await signCloudWatchOtlpRequest({
      url: this.endpoint,
      body,
      region: this.region,
      signal: 'logs',
      credentials: this.credentials,
      contentType: 'application/json',
      additionalHeaders,
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
        `CloudWatchLogExporter: HTTP ${response.status} ${response.statusText} ${text}`.trim(),
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
