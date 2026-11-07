import type { ExportResult } from '@opentelemetry/core';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace';

const KINDS = [undefined, 'SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER'];
const micros = ([s, ns]: readonly [number, number]) =>
  Math.round(s * 1e6 + ns / 1e3);

function toTags(span: ReadableSpan) {
  const { attributes, resource, status } = span;
  const tags: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes)) {
    tags[key] = String(value);
  }
  if (status.code === 1) tags['otel.status_code'] = 'OK';
  if (status.code === 2) {
    tags['otel.status_code'] = 'ERROR';
    if (status.message) tags.error = status.message;
  }
  const dropped = {
    'otel.dropped_attributes_count': span.droppedAttributesCount,
    'otel.dropped_events_count': span.droppedEventsCount,
    'otel.dropped_links_count': span.droppedLinksCount,
  };
  for (const [key, count] of Object.entries(dropped)) {
    if (count) tags[key] = String(count);
  }
  for (const [key, value] of Object.entries(resource.attributes)) {
    tags[key] = String(value);
  }
  return tags;
}

/** The shape pm2-io-otel's own exporter sends as `trace-span`. */
export function toPm2Span(span: ReadableSpan) {
  return {
    traceId: span.spanContext().traceId,
    id: span.spanContext().spanId,
    parentId: span.parentSpanContext?.spanId,
    name: span.name,
    kind: KINDS[span.kind],
    timestamp: micros(span.startTime),
    duration: micros(span.duration),
    localEndpoint: {
      serviceName: span.resource.attributes['service.name'],
    },
    tags: toTags(span),
    annotations: span.events.length
      ? span.events.map((event) => ({
          timestamp: micros(event.time),
          value: event.name,
        }))
      : undefined,
  };
}

/**
 * Sends autotel spans to PM2 as the `trace-span` messages pm2-io-otel sends.
 * Parents come from `span.parentSpanContext`, the field current SDK spans carry.
 */
export class Pm2SpanExporter implements SpanExporter {
  export(spans: ReadableSpan[], done: (result: ExportResult) => void) {
    for (const span of spans) {
      process.send?.({ type: 'trace-span', data: toPm2Span(span) });
    }
    done({ code: 0 });
  }

  async shutdown() {}
}
