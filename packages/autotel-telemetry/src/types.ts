export type TelemetryPreference = 'enabled' | 'disabled' | 'unset';

export type RunOutcome = 'success' | 'failure' | 'cancelled';

export type SanitizedField = boolean | number | string | { present: true };

export interface RunEvent {
  tool: string;
  version: string;
  command: string;
  outcome: RunOutcome;
  durationMs: number;
  flags?: Record<string, SanitizedField>;
  custom?: Record<string, boolean | number | { present: true }>;
  ci?: boolean;
  machineId?: string;
}

export interface TelemetryOptions {
  name: string;
  version: string;
  endpoint?: string;
  maxBufferBytes?: number;
  maxEventAgeMs?: number;
  allowlistedStringFlags?: string[];
}

export interface TelemetryHandle {
  readonly enabled: boolean;
  set(fields: Record<string, boolean | number>): void;
  finish(outcome: RunOutcome): Promise<void>;
  flush(): Promise<void>;
}
