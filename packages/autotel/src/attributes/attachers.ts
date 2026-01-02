/**
 * Signal attachment helpers
 * These functions know WHERE to attach attributes automatically
 * They handle span, resource, and log signals correctly
 */

import type { Span, Attributes } from '@opentelemetry/api';
import {
  resourceFromAttributes,
  type Resource,
} from '@opentelemetry/resources';
import type { TraceContext } from '../trace-context';
import { attrs } from './builders';
import { safeSetAttributes } from './utils';

export function setUser(
  spanOrContext: Span | TraceContext,
  data: import('./types').UserAttrs,
  guardrails?: import('./validators').AttributePolicy,
): void {
  const attributes = attrs.user.data(data);
  safeSetAttributes(spanOrContext, attributes, guardrails);
}

export function setSession(
  spanOrContext: Span | TraceContext,
  data: import('./types').SessionAttrs,
  guardrails?: import('./validators').AttributePolicy,
): void {
  const attributes = attrs.session.data(data);
  safeSetAttributes(spanOrContext, attributes, guardrails);
}

export function setDevice(
  spanOrContext: Span | TraceContext,
  data: import('./types').DeviceAttrs,
  guardrails?: import('./validators').AttributePolicy,
): void {
  const attributes = attrs.device.data(data);
  safeSetAttributes(spanOrContext, attributes, guardrails);
}

export function httpServer(
  spanOrContext: Span | TraceContext,
  data: import('./types').HTTPServerAttrs,
  guardrails?: import('./validators').AttributePolicy,
): void {
  const attributes = attrs.http.server(data);

  if ('updateName' in spanOrContext && data.method && data.route) {
    const span = spanOrContext as Span;
    span.updateName(`HTTP ${data.method} ${data.route}`);
  }

  safeSetAttributes(spanOrContext, attributes, guardrails);
}

export function httpClient(
  spanOrContext: Span | TraceContext,
  data: import('./types').HTTPClientAttrs,
  guardrails?: import('./validators').AttributePolicy,
): void {
  const attributes = attrs.http.client(data);
  safeSetAttributes(spanOrContext, attributes, guardrails);
}

export function dbClient(
  spanOrContext: Span | TraceContext,
  data: import('./types').DBAttrs,
  guardrails?: import('./validators').AttributePolicy,
): void {
  const attributes = attrs.db.client.data(data);
  safeSetAttributes(spanOrContext, attributes, guardrails);
}

/**
 * Merge service attributes into a Resource and return a new Resource.
 *
 * Resource.attributes is readonly, so this function returns a new merged
 * Resource rather than mutating the input.
 *
 * @param resource - The existing resource to merge with
 * @param data - Service attributes to add
 * @returns A new Resource with the merged attributes
 *
 * @example
 * ```typescript
 * const baseResource = Resource.default();
 * const enrichedResource = mergeServiceResource(baseResource, {
 *   name: 'my-service',
 *   version: '1.0.0',
 * });
 * ```
 */
export function mergeServiceResource(
  resource: Resource,
  data: import('./types').ServiceAttrs,
): Resource {
  const attributes = attrs.service.data(data);
  return resource.merge(resourceFromAttributes(attributes as Attributes));
}

export function identify(
  spanOrContext: Span | TraceContext,
  data: {
    user?: import('./types').UserAttrs;
    session?: import('./types').SessionAttrs;
    device?: import('./types').DeviceAttrs;
  },
  guardrails?: import('./validators').AttributePolicy,
): void {
  const allAttrs = [];

  if (data.user) {
    allAttrs.push(attrs.user.data(data.user));
  }
  if (data.session) {
    allAttrs.push(attrs.session.data(data.session));
  }
  if (data.device) {
    allAttrs.push(attrs.device.data(data.device));
  }

  const merged: Record<string, unknown> = {};
  for (const attrSet of allAttrs) {
    Object.assign(merged, attrSet);
  }

  safeSetAttributes(spanOrContext, merged, guardrails);
}

export function request(
  spanOrContext: Span | TraceContext,
  data: import('./types').HTTPServerAttrs & {
    clientIp?: string;
  },
  guardrails?: import('./validators').AttributePolicy,
): void {
  const httpAttrs = attrs.http.server(data);
  const networkAttrs = attrs.network.peerAddress(data.clientIp || '');
  const merged = { ...httpAttrs, ...networkAttrs };
  safeSetAttributes(spanOrContext, merged, guardrails);
}

export function setError(
  spanOrContext: Span | TraceContext,
  data: import('./types').ErrorAttrs,
  guardrails?: import('./validators').AttributePolicy,
): void {
  const attributes = attrs.error.data(data);
  safeSetAttributes(spanOrContext, attributes, guardrails);
}

export function setException(
  spanOrContext: Span | TraceContext,
  data: import('./types').ExceptionAttrs,
  guardrails?: import('./validators').AttributePolicy,
): void {
  const attributes = attrs.exception.data(data);
  safeSetAttributes(spanOrContext, attributes, guardrails);
}
