/**
 * Timestamp formatting, and the zone it renders in.
 *
 * Every clock in the viewer routes through here so one setting moves all of
 * them. Reading telemetry from a service in another region otherwise means
 * adding or subtracting hours in your head against what a colleague is
 * quoting, on every timestamp, silently and wrongly.
 *
 * `Intl.DateTimeFormat` already does the arithmetic, including the parts that
 * are easy to get wrong by hand: DST transitions, half-hour offsets, and zones
 * whose rules changed. Nothing here computes an offset.
 */

/** `local` follows the machine; anything else is an IANA zone name. */
export type TimeZonePreference = 'local' | 'utc' | (string & {});

/** The zone name `Intl` wants, or undefined to mean the machine's own. */
function resolveZone(preference: TimeZonePreference): string | undefined {
  if (preference === 'local') return undefined;
  return preference === 'utc' ? 'UTC' : preference;
}

/**
 * Build a formatter, falling back to the local zone on a name `Intl` rejects.
 *
 * A stored preference outlives the session that set it, and an unknown zone
 * should render a readable clock rather than throw through every row that
 * tried to draw one.
 */
function formatter(
  preference: TimeZonePreference,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(undefined, {
      ...options,
      timeZone: resolveZone(preference),
    });
  } catch {
    return new Intl.DateTimeFormat(undefined, options);
  }
}

/** `14:30:45` — the clock alone, for dense rows. */
export function formatClock(
  ms: number,
  preference: TimeZonePreference = 'local',
): string {
  return formatter(preference, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(ms));
}

/** `25 Aug 14:30:45` — with the date, for windows that cross midnight. */
export function formatStamp(
  ms: number,
  preference: TimeZonePreference = 'local',
): string {
  return formatter(preference, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(ms));
}

/** A short label for the zone in use, e.g. `UTC` or `GMT+9`. */
export function zoneLabel(preference: TimeZonePreference = 'local'): string {
  if (preference === 'utc') return 'UTC';
  const parts = formatter(preference, { timeZoneName: 'short' }).formatToParts(
    new Date(),
  );
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? 'Local';
}
