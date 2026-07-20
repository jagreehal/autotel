import { readPreferenceSync, resolveConsent, writePreference, purgeOutbox } from './consent';
import type { TelemetryOptions } from './types';

export interface TelemetryStatus {
  enabled: boolean;
  preference: ReturnType<typeof readPreferenceSync>;
}

export function getTelemetryStatus(toolName: string): TelemetryStatus {
  return {
    enabled: resolveConsent(toolName),
    preference: readPreferenceSync(toolName),
  };
}

export async function enableTelemetry(toolName: string): Promise<void> {
  await writePreference(toolName, 'enabled');
}

export async function disableTelemetry(toolName: string): Promise<void> {
  await writePreference(toolName, 'disabled');
  await purgeOutbox(toolName);
}

export function generateDisclosure(options: TelemetryOptions): {
  markdown: string;
  json: Record<string, unknown>;
} {
  const json = {
    tool: options.name,
    version: options.version,
    collected: ['command', 'outcome', 'durationMs', 'sanitized flags', 'optional custom counters'],
    notCollected: ['raw argv strings', 'paths', 'tokens', 'secrets'],
    optOut: ['DO_NOT_TRACK=1', 'AUTOTEL_TELEMETRY=0', 'autotel telemetry disable'],
  };
  const markdown = `# ${options.name} telemetry disclosure

Collects one structured event per command: command name, outcome, duration, sanitized flags, and optional counters via \`telemetry.set()\`.

Does not collect raw paths, tokens, or secret-shaped flag values.

Opt out with \`DO_NOT_TRACK=1\`, \`AUTOTEL_TELEMETRY=0\`, or \`autotel telemetry disable\`.
`;
  return { markdown, json };
}
