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

export function createHttpDrain(endpoint: string): TelemetryDrain {
  return async (events) => {
    if (events.length === 0) return;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events }),
    });
    if (response.ok) return;

    // A 4xx (other than 429) means the server permanently rejected this exact
    // payload — an oversized batch, an unknown tool, schema drift on older
    // buffered events. Resending the same bytes will never succeed. Returning
    // (rather than throwing) lets the caller purge the outbox: without this, the
    // batch stays buffered, and because every run resends the whole outbox first,
    // one poison batch silently blocks all future telemetry for the tool. Losing
    // one batch beats losing all of them. 429/5xx/network errors still throw, so
    // those stay buffered and retry on the next run.
    const permanentlyRejected =
      response.status >= 400 && response.status < 500 && response.status !== 429;
    if (permanentlyRejected) return;

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
