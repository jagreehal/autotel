import type { SanitizedField } from './types';

const SENSITIVE_PATTERN =
  /(?:token|secret|password|key|auth|credential|api[_-]?key|private)/i;

export function sanitizeFlags(
  argv: string[],
  allowlistedStringFlags: string[] = [],
): Record<string, SanitizedField> {
  const out: Record<string, SanitizedField> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined || !arg.startsWith('-')) continue;

    const key = arg.replace(/^-+/, '').split('=')[0] ?? arg;
    if (SENSITIVE_PATTERN.test(key)) {
      out[key] = { present: true };
      continue;
    }

    if (arg.includes('=')) {
      const [, rawValue] = arg.split('=');
      if (rawValue === undefined) continue;
      if (/^\d+$/.test(rawValue)) {
        out[key] = Number(rawValue);
      } else if (allowlistedStringFlags.includes(key)) {
        out[key] = rawValue;
      } else {
        out[key] = { present: true };
      }
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith('-')) {
      if (/^\d+$/.test(next)) {
        out[key] = Number(next);
        i++;
      } else if (allowlistedStringFlags.includes(key)) {
        out[key] = next;
        i++;
      } else {
        out[key] = { present: true };
        i++;
      }
    } else {
      out[key] = true;
    }
  }
  return out;
}

export function sanitizeCustom(
  fields: Record<string, unknown>,
): Record<string, boolean | number | { present: true }> {
  const out: Record<string, boolean | number | { present: true }> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'boolean' || typeof value === 'number') {
      out[key] = value;
    } else if (value !== null && value !== undefined) {
      out[key] = { present: true };
    }
  }
  return out;
}
