/**
 * Datadog's own names for spans, written beside the OpenTelemetry ones.
 *
 * Datadog groups APM by `operation.name` and, under it, `resource.name`. When a
 * span carries neither, Datadog derives them, and for three common kinds the
 * result groups everything together: an outbound call is resource `POST`, an
 * MCP request is `mcp.request`, and an internal span is operation `Internal`.
 * OpenTelemetry's span names stay as the conventions define them; these two
 * attributes are what Datadog reads instead.
 *
 * ```ts
 * import { datadogNames } from 'autotel-datadog/names';
 *
 * init({ ...createDatadogConfig(options), spanEnrichers: [datadogNames()] });
 * initFull({ service, endpoint: '/otel', spanEnrichers: [datadogNames()] });
 * ```
 *
 * Runs on any runtime: it reads span attributes and nothing else.
 */

import { SpanKind, type AttributeValue } from '@opentelemetry/api';
import type { Span, SpanProcessor } from '@opentelemetry/sdk-trace';
import { asString } from './values';

const RESOURCE_NAME = 'resource.name';
const OPERATION_NAME = 'operation.name';

function text(value: AttributeValue | undefined): string | undefined {
  return asString(value) || undefined;
}

/**
 * `tools/call get_contract`, as MCP's convention names the span. A resource
 * read keeps the method alone, since its URI can hold an id.
 */
function mcpResource(span: Span): string | undefined {
  const method = text(span.attributes['mcp.method.name']);
  if (!method) return undefined;
  const target =
    text(span.attributes['gen_ai.tool.name']) ??
    text(span.attributes['gen_ai.prompt.name']);
  return target ? `${method} ${target}` : method;
}

/**
 * `GET /users/:id` when the call has a `url.template`, otherwise `POST
 * api.stripe.com`. The host is low-cardinality, and Datadog reads it from
 * here, so the OpenTelemetry span name can keep the method alone.
 */
function clientResource(span: Span): string | undefined {
  if (span.kind !== SpanKind.CLIENT) return undefined;
  const method = text(span.attributes['http.request.method']);
  if (!method) return undefined;
  const target =
    text(span.attributes['url.template']) ??
    text(span.attributes['server.address']);
  return target ? `${method} ${target}` : undefined;
}

/**
 * A span processor that sets `resource.name` on MCP and outbound HTTP spans,
 * and `operation.name` on internal spans, when the span ends. A value the span
 * already has stays.
 */
export function datadogNames(): SpanProcessor {
  return {
    onStart() {},
    onEnding(span) {
      if (span.attributes[RESOURCE_NAME] === undefined) {
        const resource = mcpResource(span) ?? clientResource(span);
        if (resource) span.setAttribute(RESOURCE_NAME, resource);
      }
      if (
        span.kind === SpanKind.INTERNAL &&
        span.attributes[OPERATION_NAME] === undefined
      ) {
        span.setAttribute(OPERATION_NAME, span.name);
      }
    },
    onEnd() {},
    forceFlush: async () => {},
    shutdown: async () => {},
  };
}
