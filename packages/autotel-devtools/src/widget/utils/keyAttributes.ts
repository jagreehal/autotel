import type { AttributeValue, SpanAttributes } from '../types';

/**
 * Attributes worth a glance without opening the detail panel: the ones that
 * say *what* happened (route, query, model, tool, outcome) rather than who
 * emitted it. Order is display order; only keys present render.
 *
 * Shared by the waterfall hover card and the log rows, so one allowlist
 * decides what "at a glance" means everywhere.
 */
const KEY_ATTRIBUTES = [
  'http.request.method',
  'http.method',
  'http.route',
  'url.path',
  'http.response.status_code',
  'http.status_code',
  'db.system.name',
  'db.system',
  'db.operation.name',
  'db.query.text',
  'db.statement',
  'rpc.service',
  'rpc.method',
  'messaging.system',
  'messaging.destination.name',
  'gen_ai.operation.name',
  'gen_ai.request.model',
  'gen_ai.tool.name',
  'gen_ai.usage.input_tokens',
  'gen_ai.usage.output_tokens',
  // Claude Code events and spans (flat names)
  'model',
  'tool_name',
  'hook_event',
  'hook_name',
  'plugin.name',
  'server_name',
  'decision',
  'status',
  'success',
  'input_tokens',
  'output_tokens',
  'duration_ms',
  'cost_usd',
  'prompt_length',
  'error.type',
  'exception.type',
  'exception.message',
  'peer.service',
  'server.address',
] as const;

const SENSITIVE_RE = /(password|secret|token|authorization|api[-_.]?key)/i;

/**
 * A number or boolean cannot hold a credential: `gen_ai.usage.input_tokens`
 * matches the key pattern but carries a count, which is the number someone
 * opened the panel to read. Strings, arrays and objects stay masked.
 *
 * The one rule for every surface that shows a value: the detail panel masks
 * behind a reveal, previews (rows, tags, hover cards) only ever show the mask.
 */
export function isSensitiveAttribute(
  key: string,
  value: AttributeValue,
): boolean {
  const countLike = value === true || value === false || Number.isFinite(value);
  return !countLike && SENSITIVE_RE.test(key);
}

export const REDACTED = '[redacted]';

function previewValue(
  key: string,
  value: AttributeValue,
  maxLength: number,
): string {
  if (isSensitiveAttribute(key, value)) return REDACTED;
  const text = value instanceof Object ? JSON.stringify(value) : String(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

export function keyAttributes(
  attributes: SpanAttributes,
  max = Number.POSITIVE_INFINITY,
): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const key of KEY_ATTRIBUTES) {
    if (out.length >= max) break;
    const value = attributes[key];
    if (value === undefined || value === null) continue;
    out.push([key, previewValue(key, value, 120)]);
  }
  return out;
}

/**
 * Namespaces the OpenTelemetry resource fills in: who emitted the span, the
 * same on every span from that process.
 */
const RESOURCE_NAMESPACES = [
  'service',
  'deployment',
  'telemetry',
  'process',
  'host',
  'os',
  'container',
  'k8s',
  'cloud',
  'faas',
  'otel',
  'datadog',
];

/**
 * Resource namespaces plus what SDKs and auto-instrumentation set per span.
 * Anything else was set by the app's own code: the attributes worth reading.
 */
const AUTO_NAMESPACES = new Set([
  ...RESOURCE_NAMESPACES,
  'code',
  'error',
  'exception',
  'http',
  'url',
  'net',
  'network',
  'server',
  'client',
  'db',
  'rpc',
  'messaging',
  'user_agent',
  'thread',
  'express',
  'next',
  'operation',
  'autotel',
]);

const namespaceOf = (key: string) => key.split('.', 1)[0]!;

export function isResourceAttribute(key: string): boolean {
  return RESOURCE_NAMESPACES.includes(namespaceOf(key));
}

export function isAppAttribute(key: string): boolean {
  return !AUTO_NAMESPACES.has(namespaceOf(key));
}

/**
 * The app's own attributes in insertion order, values stringified, sensitive
 * ones masked. `maxLength` caps each value for one-line previews; pass
 * Infinity where the full value has room (the hover card).
 */
export function appAttributes(
  attributes: SpanAttributes,
  max = Number.POSITIVE_INFINITY,
  maxLength = 60,
): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(attributes)) {
    if (out.length >= max) break;
    if (value === undefined || value === null || !isAppAttribute(key)) continue;
    out.push([key, previewValue(key, value, maxLength)]);
  }
  return out;
}

/** `statements.outcome` → `outcome`: the label a one-line preview has room for. */
export function shortKey(key: string): string {
  return key.slice(key.lastIndexOf('.') + 1);
}
