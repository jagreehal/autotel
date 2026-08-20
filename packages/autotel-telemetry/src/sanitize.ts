import type { SanitizedField } from './types';

/** A flag or field reduced to what is safe to report. */
export type SanitizedFields = Record<string, SanitizedField>;

/** Custom fields after sanitizing: a raw string never survives this. */
export type SanitizedCustomFields = Record<
  string,
  boolean | number | { present: true }
>;

/** A finite number, as opposed to the strings and markers around it. */
function isNumber(value: SanitizedField): value is number {
  return Number.isFinite(value);
}

const SENSITIVE_PATTERN =
  /(?:token|secret|password|key|auth|credential|api[_-]?key|private)/i;

export function sanitizeFlags(
  argv: string[],
  allowlistedStringFlags: string[] = [],
): SanitizedFields {
  const entries: Array<[string, SanitizedField]> = [];

  /** What a flag's value is worth reporting as, once the key is known safe. */
  const valueOf = (key: string, rawValue: string): SanitizedField => {
    if (/^\d+$/.test(rawValue)) return Number(rawValue);
    if (allowlistedStringFlags.includes(key)) return rawValue;
    return { present: true };
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined || !arg.startsWith('-')) continue;

    const key = arg.replace(/^-+/, '').split('=')[0] ?? arg;
    if (SENSITIVE_PATTERN.test(key)) {
      entries.push([key, { present: true }]);
      continue;
    }

    if (arg.includes('=')) {
      const [, rawValue] = arg.split('=');
      if (rawValue === undefined) continue;
      entries.push([key, valueOf(key, rawValue)]);
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith('-')) {
      entries.push([key, valueOf(key, next)]);
      i++;
    } else {
      entries.push([key, true]);
    }
  }

  return Object.fromEntries(entries);
}

export function sanitizeCustom(fields: SanitizedFields): SanitizedCustomFields {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => {
        if (value === true || value === false) return [key, value];
        if (isNumber(value)) return [key, value];
        // A string is reported as present rather than by its contents.
        return [key, { present: true }];
      }),
  );
}
