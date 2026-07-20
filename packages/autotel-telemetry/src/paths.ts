import { homedir } from 'node:os';
import path from 'node:path';

export function getTelemetryDir(toolName: string): string {
  const safe = toolName.replaceAll(/[^a-zA-Z0-9._-]/g, '-');
  return path.join(homedir(), '.autotel', 'telemetry', safe);
}
