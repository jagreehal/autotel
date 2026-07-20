import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TelemetryOutbox } from './outbox';
import { getTelemetryDir } from './paths';

export type TelemetryPreference = 'enabled' | 'disabled' | 'unset';

interface PreferenceFile {
  preference: TelemetryPreference;
}

export function resolveConsent(toolName: string): boolean {
  if (process.env.DO_NOT_TRACK === '1') return false;
  if (process.env.AUTOTEL_TELEMETRY === '0') return false;
  if (process.env.AUTOTEL_TELEMETRY === '1') return true;

  const pref = readPreferenceSync(toolName);
  if (pref === 'disabled') return false;
  if (pref === 'enabled') return true;

  // Opt-in by default: telemetry stays off until the user explicitly enables it
  // (e.g. `autotel telemetry enable`) or sets AUTOTEL_TELEMETRY=1.
  return false;
}

export function readPreferenceSync(toolName: string): TelemetryPreference {
  try {
    const raw = readFileSync(
      path.join(getTelemetryDir(toolName), 'preference.json'),
      'utf8',
    );
    const parsed = JSON.parse(raw) as PreferenceFile;
    return parsed.preference ?? 'unset';
  } catch {
    return 'unset';
  }
}

export async function writePreference(
  toolName: string,
  preference: TelemetryPreference,
): Promise<void> {
  const dir = getTelemetryDir(toolName);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'preference.json'),
    JSON.stringify({ preference }),
    'utf8',
  );
}

export async function purgeOutbox(toolName: string): Promise<void> {
  await new TelemetryOutbox({ toolName }).purge();
}
