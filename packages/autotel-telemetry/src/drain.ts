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
    if (!response.ok) {
      throw new Error(`Telemetry delivery failed with HTTP ${response.status}`);
    }
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
