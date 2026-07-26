import type { RunEvent } from './types';

export type TelemetryDrain = (events: RunEvent[]) => Promise<void>;

export function createNoopDrain(): TelemetryDrain {
  return async () => {};
}

export function createDebugDrain(): TelemetryDrain {
  return async (events) => {
    if (process.env.AUTOTEL_TELEMETRY_DEBUG === '1') {
      for (const event of events) {
        console.error('[autotel-telemetry]', JSON.stringify(event));
      }
    }
  };
}

// 4xx statuses that are worth retrying rather than dropping: the same payload
// may succeed later (timeout, too-early, rate-limited).
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429]);

export function createHttpDrain(endpoint: string): TelemetryDrain {
  return async (events) => {
    if (events.length === 0) return;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events }),
    });
    if (response.ok) return;

    // Only a permanent 4xx means the server rejected this exact payload — an
    // oversized batch, an unknown tool, schema drift on older buffered events.
    // Resending the same bytes will never succeed. Returning (rather than
    // throwing) lets the caller purge the outbox: without this, the batch stays
    // buffered, and because every run resends the whole outbox first, one poison
    // batch silently blocks all future telemetry for the tool. Losing one batch
    // beats losing all of them. Everything else non-2xx — retryable 4xx (408
    // Request Timeout, 425 Too Early, 429 Too Many Requests), 3xx, 5xx, and
    // network errors — throws, so the batch stays buffered and retries next run.
    const isPermanentRejection =
      response.status >= 400 &&
      response.status < 500 &&
      !RETRYABLE_STATUS_CODES.has(response.status);
    if (isPermanentRejection) return;

    throw new Error(`Telemetry delivery failed with HTTP ${response.status}`);
  };
}

export function composeDrains(...drains: TelemetryDrain[]): TelemetryDrain {
  return async (events) => {
    await Promise.all(drains.map((drain) => drain(events)));
  };
}

export function resolveEndpoint(explicit?: string): string | undefined {
  return explicit ?? process.env.AUTOTEL_TELEMETRY_ENDPOINT;
}
