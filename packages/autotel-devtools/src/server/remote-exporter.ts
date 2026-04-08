/**
 * Remote Span Exporter for sending traces to a hosted DevtoolsServer
 *
 * Use this when the DevtoolsServer is running on a different machine/process.
 *
 * @example
 * ```typescript
 * import { DevtoolsRemoteExporter } from '@autotel/devtools/server';
 * import { init } from 'autotel';
 *
 * init({
 *   service: 'my-app',
 *   spanExporters: [
 *     new DevtoolsRemoteExporter({
 *       endpoint: 'https://autotel.mycompany.com',
 *       apiKey: process.env.AUTOTEL_API_KEY,
 *     })
 *   ]
 * });
 * ```
 */

import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import type { ExportResult, ExportResultCode } from '@opentelemetry/core';
import type { TraceData, SpanData } from './types';

export interface DevtoolsRemoteExporterOptions {
  /**
   * Base URL of the Devtools server
   * e.g., 'https://autotel.mycompany.com' or 'http://localhost:8082'
   */
  endpoint: string;

  /**
   * API key for authentication (if server requires it)
   */
  apiKey?: string;

  /**
   * Service name for traces (default: 'unknown-service')
   */
  serviceName?: string;

  /**
   * Request timeout in milliseconds (default: 5000)
   */
  timeout?: number;

  /**
   * Retry failed requests (default: true)
   */
  retry?: boolean;

  /**
   * Number of retries (default: 3)
   */
  retryCount?: number;

  /**
   * Retry delay in milliseconds (default: 1000)
   */
  retryDelay?: number;

  /**
   * Enable verbose logging (default: false)
   */
  verbose?: boolean;
}

export class DevtoolsRemoteExporter implements SpanExporter {
  private options: Required<DevtoolsRemoteExporterOptions>;
  private pendingExports: Promise<void>[] = [];

  constructor(options: DevtoolsRemoteExporterOptions) {
    this.options = {
      endpoint: options.endpoint.replace(/\/$/, ''), // Remove trailing slash
      apiKey: options.apiKey ?? '',
      serviceName: options.serviceName ?? 'unknown-service',
      timeout: options.timeout ?? 5000,
      retry: options.retry ?? true,
      retryCount: options.retryCount ?? 3,
      retryDelay: options.retryDelay ?? 1000,
      verbose: options.verbose ?? false,
    };
  }

  /**
   * Export spans to the remote server
   */
  async export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): Promise<void> {
    // Start export asynchronously
    const exportPromise = this.doExport(spans)
      .then(() => {
        resultCallback({ code: 0 as ExportResultCode }); // SUCCESS
      })
      .catch((error) => {
        this.log(`Export failed: ${error.message}`);
        resultCallback({ code: 1 as ExportResultCode }); // FAILED
      });

    this.pendingExports.push(exportPromise);

    // Clean up completed exports
    exportPromise.finally(() => {
      const index = this.pendingExports.indexOf(exportPromise);
      if (index !== -1) {
        this.pendingExports.splice(index, 1);
      }
    });
  }

  private async doExport(spans: ReadableSpan[]): Promise<void> {
    if (spans.length === 0) return;

    this.log(`Exporting ${spans.length} span(s) to ${this.options.endpoint}`);

    // Group spans by trace ID and convert
    const traceMap = new Map<string, ReadableSpan[]>();
    for (const span of spans) {
      const traceId = span.spanContext().traceId;
      if (!traceMap.has(traceId)) {
        traceMap.set(traceId, []);
      }
      traceMap.get(traceId)!.push(span);
    }

    const traces: TraceData[] = [];
    for (const [traceId, traceSpans] of traceMap) {
      traces.push(this.convertToTraceData(traceId, traceSpans));
    }

    // Send with retry
    await this.sendWithRetry({ traces });
  }

  private async sendWithRetry(payload: { traces: TraceData[] }): Promise<void> {
    let lastError: Error | null = null;
    const maxAttempts = this.options.retry ? this.options.retryCount : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.send(payload);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.log(
          `Attempt ${attempt}/${maxAttempts} failed: ${lastError.message}`,
        );

        if (attempt < maxAttempts) {
          await this.sleep(this.options.retryDelay * attempt); // Exponential backoff
        }
      }
    }

    throw lastError || new Error('Export failed');
  }

  private async send(payload: { traces: TraceData[] }): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.options.timeout,
    );

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (this.options.apiKey) {
        headers['Authorization'] = `Bearer ${this.options.apiKey}`;
      }

      const response = await fetch(`${this.options.endpoint}/ingest/traces`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      const result = (await response.json()) as { processed: number };
      this.log(`Successfully sent ${result.processed} trace(s)`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Shutdown the exporter, waiting for pending exports
   */
  async shutdown(): Promise<void> {
    this.log('Shutting down, waiting for pending exports...');
    await Promise.allSettled(this.pendingExports);
    this.log('Shutdown complete');
  }

  /**
   * Force flush pending exports
   */
  async forceFlush(): Promise<void> {
    await Promise.allSettled(this.pendingExports);
  }

  private convertToTraceData(
    traceId: string,
    spans: ReadableSpan[],
  ): TraceData {
    const spanData: SpanData[] = spans.map((span) => this.convertSpan(span));

    // Find root span (no parent)
    const rootSpan = spanData.find((s) => !s.parentSpanId) || spanData[0];

    // Sort spans by start time
    spanData.sort((a, b) => a.startTime - b.startTime);

    const startTime = Math.min(...spanData.map((s) => s.startTime));
    const endTime = Math.max(...spanData.map((s) => s.endTime));

    const hasError = spanData.some((s) => s.status.code === 'ERROR');
    const status = hasError ? 'ERROR' : 'OK';

    return {
      traceId,
      correlationId: traceId.slice(0, 16),
      rootSpan,
      spans: spanData,
      startTime,
      endTime,
      duration: endTime - startTime,
      status: status as 'OK' | 'ERROR' | 'UNSET',
      service: this.options.serviceName,
    };
  }

  private convertSpan(span: ReadableSpan): SpanData {
    const spanContext = span.spanContext();
    const startTime = span.startTime[0] * 1000 + span.startTime[1] / 1_000_000;
    const endTime = span.endTime[0] * 1000 + span.endTime[1] / 1_000_000;

    const attributes: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(span.attributes)) {
      attributes[key] = value;
    }

    let status: 'OK' | 'ERROR' | 'UNSET';
    switch (span.status.code) {
      case 0: {
        status = 'UNSET';
        break;
      }
      case 1: {
        status = 'OK';
        break;
      }
      case 2: {
        status = 'ERROR';
        break;
      }
      default: {
        status = 'UNSET';
      }
    }

    const events = span.events.map((event) => ({
      name: event.name,
      timestamp: event.time[0] * 1000 + event.time[1] / 1_000_000,
      attributes: event.attributes
        ? Object.fromEntries(Object.entries(event.attributes))
        : undefined,
    }));

    return {
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
      parentSpanId: (span as any).parentSpanId,
      name: span.name,
      kind: this.convertSpanKind(span.kind),
      startTime,
      endTime,
      duration: endTime - startTime,
      attributes,
      status: {
        code: status,
        message: span.status.message,
      },
      events: events.length > 0 ? events : undefined,
    };
  }

  private convertSpanKind(
    kind: number,
  ): 'INTERNAL' | 'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER' {
    switch (kind) {
      case 0: {
        return 'INTERNAL';
      }
      case 1: {
        return 'SERVER';
      }
      case 2: {
        return 'CLIENT';
      }
      case 3: {
        return 'PRODUCER';
      }
      case 4: {
        return 'CONSUMER';
      }
      default: {
        return 'INTERNAL';
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private log(message: string): void {
    if (this.options.verbose) {
      console.log(`[Devtools Remote Exporter] ${message}`);
    }
  }
}
