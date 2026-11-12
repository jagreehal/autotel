/**
 * Copies allowed baggage entries onto an event's attributes, so an event knows
 * what its request knew (a session id, a tenant). Shared by `Event` and
 * `track()`: an allowlist in `init({ events: { enrichFromBaggage } })` applies
 * to both.
 */

import { context, propagation } from '@opentelemetry/api';
import type { EventAttributes } from './event-subscriber';
import { type EnrichFromBaggageConfig, hashValue } from './events-config';
import { getEventsConfig } from './init';

/** Exact keys, or `prefix.*` for every key under a prefix. */
function matchesPattern(key: string, pattern: string): boolean {
  return pattern.endsWith('.*')
    ? key.startsWith(`${pattern.slice(0, -2)}.`)
    : key === pattern;
}

/** The deny list wins over the allow list. */
function isAllowed(key: string, config: EnrichFromBaggageConfig): boolean {
  if (config.deny?.some((pattern) => matchesPattern(key, pattern))) {
    return false;
  }
  return config.allow.some((pattern) => matchesPattern(key, pattern));
}

/**
 * The attributes plus every allowed baggage entry in the active context,
 * within `maxKeys` and `maxBytes` (checked after transforms, so a hash counts
 * at its own size). Unchanged when enrichment is not configured.
 */
export function enrichFromBaggage(attributes: EventAttributes): EventAttributes;
export function enrichFromBaggage(
  attributes: EventAttributes | undefined,
): EventAttributes | undefined;
export function enrichFromBaggage(
  attributes: EventAttributes | undefined,
): EventAttributes | undefined {
  const config = getEventsConfig()?.enrichFromBaggage;
  const baggage = propagation.getBaggage(context.active());
  if (!config || !baggage) return attributes;

  const enriched: EventAttributes = { ...attributes };

  const maxKeys = config.maxKeys ?? 10;
  const maxBytes = config.maxBytes ?? 1024;
  const prefix = config.prefix ?? '';
  let keyCount = 0;
  let byteCount = 0;

  for (const [key, entry] of baggage.getAllEntries()) {
    if (!isAllowed(key, config)) continue;
    if (keyCount >= maxKeys) break;

    const transform = config.transform?.[key];
    const value =
      transform === 'hash'
        ? hashValue(entry.value)
        : transform === undefined || transform === 'plain'
          ? entry.value
          : transform(entry.value);

    const valueBytes = new TextEncoder().encode(value).length;
    if (byteCount + valueBytes > maxBytes) continue;

    enriched[`${prefix}${key}`] = value;
    keyCount++;
    byteCount += valueBytes;
  }

  return enriched;
}
