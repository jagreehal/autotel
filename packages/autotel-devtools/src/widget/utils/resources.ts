import type { ErrorGroup, LogData, SpanData, TraceData } from '../types';
import type { SpanAttributes } from '../types.js';
import { asString } from '../attrs.js';

export type ResourceType =
  'service' | 'database' | 'cache' | 'messaging' | 'external' | 'unknown';

export type ResourceHealth = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface ResourceSummary {
  name: string;
  type: ResourceType;
  health: ResourceHealth;
  requestCount: number;
  errorCount: number;
  traceCount: number;
  logCount: number;
  lastSeen?: number;
}

export function inferResourceName(
  span: Pick<SpanData, 'attributes'>,
  traceService?: string,
): string {
  const attrs = span.attributes || {};
  const candidates = [
    attrs['service.name'],
    attrs['service.peer.name'],
    attrs['peer.service'],
    attrs['http.host'],
    attrs['db.system.name'],
    attrs['db.system'],
    attrs['messaging.system'],
    attrs['rpc.service'],
    traceService,
  ];

  for (const candidate of candidates) {
    const named = asString(candidate)?.trim();
    if (named) return named;
  }

  return 'unknown';
}

export function inferResourceType(
  attributes: SpanAttributes,
  name: string,
): ResourceType {
  if (
    asString(attributes['db.system.name']) !== undefined ||
    asString(attributes['db.system']) !== undefined
  )
    return 'database';
  if (asString(attributes['cache.system']) !== undefined) return 'cache';
  if (asString(attributes['messaging.system']) !== undefined)
    return 'messaging';
  if (
    asString(attributes['service.peer.name']) !== undefined ||
    asString(attributes['peer.service']) !== undefined ||
    asString(attributes['net.peer.name']) !== undefined ||
    asString(attributes['http.host']) !== undefined
  ) {
    return name === attributes['service.name'] ? 'service' : 'external';
  }
  if (asString(attributes['service.name']) !== undefined) return 'service';
  return 'unknown';
}

export function getLogResourceName(log: LogData): string {
  if (log.resourceName) return log.resourceName;
  const resource = log.resource || {};
  const candidates = [
    resource['service.name'],
    resource['service.namespace'],
    resource['host.name'],
    resource['container.name'],
  ];

  for (const candidate of candidates) {
    const named = asString(candidate)?.trim();
    if (named) return named;
  }

  return 'unknown';
}

export function classifyResourceHealth(
  requestCount: number,
  errorCount: number,
): ResourceHealth {
  if (requestCount === 0 && errorCount === 0) return 'unknown';
  const errorRate = requestCount === 0 ? 1 : errorCount / requestCount;
  if (errorRate >= 0.2) return 'unhealthy';
  if (errorRate >= 0.05) return 'degraded';
  return 'healthy';
}

export function buildResourceSummaries(args: {
  traces: TraceData[];
  logs: LogData[];
  errors: ErrorGroup[];
}): ResourceSummary[] {
  const resourceMap = new Map<string, ResourceSummary>();

  const ensure = (
    name: string,
    type: ResourceType = 'unknown',
  ): ResourceSummary => {
    const existing = resourceMap.get(name);
    if (existing) {
      if (existing.type === 'unknown' && type !== 'unknown')
        existing.type = type;
      return existing;
    }

    const created: ResourceSummary = {
      name,
      type,
      health: 'unknown',
      requestCount: 0,
      errorCount: 0,
      traceCount: 0,
      logCount: 0,
    };
    resourceMap.set(name, created);
    return created;
  };

  for (const trace of args.traces) {
    const seenInTrace = new Set<string>();
    for (const span of trace.spans) {
      const name = inferResourceName(span, trace.service);
      const resource = ensure(name, inferResourceType(span.attributes, name));
      resource.requestCount += 1;
      resource.lastSeen = Math.max(resource.lastSeen ?? 0, span.endTime);
      if (span.status.code === 'ERROR') resource.errorCount += 1;
      if (!seenInTrace.has(name)) {
        resource.traceCount += 1;
        seenInTrace.add(name);
      }
    }
  }

  for (const log of args.logs) {
    const name = getLogResourceName(log);
    const resource = ensure(name, 'service');
    resource.logCount += 1;
    resource.lastSeen = Math.max(resource.lastSeen ?? 0, log.timestamp);
  }

  for (const error of args.errors) {
    if (!error.service) continue;
    const resource = ensure(error.service, 'service');
    resource.errorCount += error.count;
    resource.lastSeen = Math.max(resource.lastSeen ?? 0, error.lastSeen);
  }

  return [...resourceMap.values()]
    .map((resource) => ({
      ...resource,
      health: classifyResourceHealth(
        resource.requestCount,
        resource.errorCount,
      ),
    }))
    .sort((a, b) => {
      const byActivity = (b.lastSeen ?? 0) - (a.lastSeen ?? 0);
      return byActivity !== 0 ? byActivity : a.name.localeCompare(b.name);
    });
}
