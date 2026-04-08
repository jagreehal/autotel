/**
 * Log record exporter that sends OTel logs to a Devtools server HTTP ingest.
 * Use with BatchLogRecordProcessor when you want to view logs in the Autotel widget/extension.
 *
 * @example
 * ```typescript
 * import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
 * import { DevtoolsLogExporter } from '@autotel/devtools/server';
 * import { init } from 'autotel';
 *
 * init({
 *   service: 'my-app',
 *   logRecordProcessors: [
 *     new BatchLogRecordProcessor(
 *       new DevtoolsLogExporter({ endpoint: 'http://localhost:8082' })
 *     ),
 *   ],
 * });
 * ```
 */

import type { ExportResult } from '@opentelemetry/core';
import { ExportResultCode } from '@opentelemetry/core';
import type { LogRecordExporter } from '@opentelemetry/sdk-logs';
import type { ReadableLogRecord } from '@opentelemetry/sdk-logs';
import type { LogData } from './types';
import { getResourceName } from './resource-utils';

export interface DevtoolsLogExporterOptions {
  /**
   * Base URL of the Devtools HTTP ingest server
   * e.g. 'http://localhost:8082'
   */
  endpoint: string;

  /**
   * API key for authentication (if server requires it)
   */
  apiKey?: string;

  /**
   * Request timeout in milliseconds (default: 5000)
   */
  timeout?: number;
}

const defaultTimeout = 5000;

function hrTimeToMs(hrTime: [number, number]): number {
  return hrTime[0] * 1000 + hrTime[1] / 1e6;
}

function bodyToPayload(body: ReadableLogRecord['body']): string | Record<string, unknown> {
  if (body === undefined) return '';
  if (typeof body === 'string') return body;
  if (typeof body === 'object' && body !== null) return body as Record<string, unknown>;
  return String(body);
}

function recordToLogData(record: ReadableLogRecord, index: number): LogData {
  const id = `log-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 9)}`;
  const timestamp = hrTimeToMs(record.hrTime);
  const body = bodyToPayload(record.body);
  const attributes = record.attributes && Object.keys(record.attributes).length > 0
    ? (record.attributes as Record<string, unknown>)
    : undefined;
  const resource = record.resource?.attributes && Object.keys(record.resource.attributes).length > 0
    ? (record.resource.attributes as Record<string, unknown>)
    : undefined;

  const log: LogData = {
    id,
    resourceName: getResourceName(resource),
    severityText: record.severityText,
    severityNumber: record.severityNumber,
    body,
    timestamp,
    attributes,
    resource,
  };

  if (record.spanContext) {
    log.traceId = record.spanContext.traceId;
    log.spanId = record.spanContext.spanId;
  }

  return log;
}

export class DevtoolsLogExporter implements LogRecordExporter {
  private endpoint: string;
  private apiKey: string;
  private timeout: number;
  private isShutdown = false;

  constructor(options: DevtoolsLogExporterOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, '');
    this.apiKey = options.apiKey ?? '';
    this.timeout = options.timeout ?? defaultTimeout;
  }

  export(logs: ReadableLogRecord[], resultCallback: (result: ExportResult) => void): void {
    if (this.isShutdown || logs.length === 0) {
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }

    const payload = { logs: logs.map((r, i) => recordToLogData(r, i)) };
    const url = `${this.endpoint}/ingest/logs`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
      .then((res) => {
        clearTimeout(timeoutId);
        if (!res.ok) {
          throw new Error(`Devtools log ingest failed: ${res.status} ${res.statusText}`);
        }
        resultCallback({ code: ExportResultCode.SUCCESS });
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        resultCallback({
          code: ExportResultCode.FAILED,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });
  }

  shutdown(): Promise<void> {
    this.isShutdown = true;
    return Promise.resolve();
  }
}
