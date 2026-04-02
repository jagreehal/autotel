/**
 * OpenTelemetry SpanExporter that streams spans to DevtoolsServer
 */

import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import type { ExportResult, ExportResultCode } from '@opentelemetry/core';
import type { DevtoolsServer } from './server';
import type { TraceData, SpanData } from './types';

export class DevtoolsSpanExporter implements SpanExporter {
  private server: DevtoolsServer;
  private serviceName: string;

  constructor(server: DevtoolsServer, serviceName: string = 'unknown-service') {
    this.server = server;
    this.serviceName = serviceName;
  }

  /**
   * Export spans to the WebSocket server
   */
  async export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): Promise<void> {
    // Immediately call the callback to unblock the span processor
    // Then process the spans asynchronously
    resultCallback({ code: 0 as ExportResultCode });

    // Process spans asynchronously without blocking
    Promise.resolve().then(() => {
      try {
        console.log(`[Autotel Exporter] Exporting ${spans.length} span(s)`);

        // Group spans by trace ID
        const traceMap = new Map<string, ReadableSpan[]>();

        for (const span of spans) {
          const traceId = span.spanContext().traceId;
          if (!traceMap.has(traceId)) {
            traceMap.set(traceId, []);
          }
          traceMap.get(traceId)!.push(span);
        }

        // Convert each trace and send to server
        for (const [traceId, traceSpans] of traceMap) {
          const trace = this.convertToTraceData(traceId, traceSpans);
          console.log(
            `[Autotel Exporter] Adding trace ${traceId.slice(0, 16)} with ${traceSpans.length} spans`,
          );
          this.server.addTrace(trace);
        }
      } catch (error) {
        console.error('[Autotel Exporter] Export error:', error);
      }
    });
  }

  /**
   * Shutdown the exporter
   */
  async shutdown(): Promise<void> {
    // Nothing to clean up
  }

  /**
   * Force flush any buffered spans
   */
  async forceFlush(): Promise<void> {
    // Nothing to flush
  }

  /**
   * Convert OpenTelemetry spans to TraceData
   */
  private convertToTraceData(
    traceId: string,
    spans: ReadableSpan[],
  ): TraceData {
    // Convert spans
    const spanData: SpanData[] = spans.map((span) => this.convertSpan(span));

    // Find root span (no parent)
    const rootSpan = spanData.find((s) => !s.parentSpanId) || spanData[0];

    // Sort spans by start time
    spanData.sort((a, b) => a.startTime - b.startTime);

    const startTime = Math.min(...spanData.map((s) => s.startTime));
    const endTime = Math.max(...spanData.map((s) => s.endTime));

    // Determine overall status (ERROR if any span errored)
    const hasError = spanData.some((s) => s.status.code === 'ERROR');
    const status = hasError ? 'ERROR' : 'OK';

    return {
      traceId,
      correlationId: traceId.slice(0, 16), // First 16 chars
      rootSpan,
      spans: spanData,
      startTime,
      endTime,
      duration: endTime - startTime,
      status: status as 'OK' | 'ERROR' | 'UNSET',
      service: this.serviceName,
    };
  }

  /**
   * Convert OpenTelemetry span to SpanData
   */
  private convertSpan(span: ReadableSpan): SpanData {
    const spanContext = span.spanContext();
    const startTime = span.startTime[0] * 1000 + span.startTime[1] / 1_000_000;
    const endTime = span.endTime[0] * 1000 + span.endTime[1] / 1_000_000;

    // Convert attributes
    const attributes: Record<string, any> = {};
    for (const [key, value] of Object.entries(span.attributes)) {
      attributes[key] = value;
    }

    // Convert status
    const statusCode = span.status.code;
    let status: 'OK' | 'ERROR' | 'UNSET';
    switch (statusCode) {
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

    // Convert events
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

  /**
   * Convert OpenTelemetry SpanKind to string
   */
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
}
