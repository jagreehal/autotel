import type { CheckId, RawRouteEntry, RouteEntry } from './types';

/** Why an entry point is not held to some rules, and to which ones. */
export interface RouteExemption {
  /** Shown in the report in place of the check's verdict. */
  reason: string;
  /**
   * `'all'` rather than a list of ids on purpose: an exemption that enumerates
   * ids has to be revisited every time a rule is added, and forgetting is
   * silent — the new rule simply starts failing on exempt routes.
   */
  skip: 'all' | readonly CheckId[];
}

/**
 * Paths with nothing to instrument, as consecutive path segments.
 *
 * Matched segment by segment rather than as a substring: an exemption skips
 * every rule, so a loose match is the worst bug this tool can have — it drops a
 * real handler out of the score instead of reporting a gap.
 */
const EXEMPT_SEGMENTS: { segments: readonly string[]; reason: string }[] = [
  { segments: ['health'], reason: 'health check — nothing to instrument' },
  { segments: ['healthz'], reason: 'health check — nothing to instrument' },
  { segments: ['livez'], reason: 'liveness probe — nothing to instrument' },
  { segments: ['readyz'], reason: 'readiness probe — nothing to instrument' },
  { segments: ['ping'], reason: 'liveness probe — nothing to instrument' },
  { segments: ['metrics'], reason: 'metrics endpoint — telemetry plumbing' },
  {
    segments: ['api', 'otel'],
    reason: 'autotel infrastructure — telemetry ingest',
  },
  {
    segments: ['api', 'telemetry'],
    reason: 'autotel infrastructure — telemetry ingest',
  },
];

/** Path or file split into lowercase segments, extension and method suffix dropped. */
function segmentsOf(value: string): string[] {
  return value
    .toLowerCase()
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.split('.')[0] ?? segment);
}

function containsRun(
  segments: readonly string[],
  pattern: readonly string[],
): boolean {
  return segments.some((_, index) =>
    pattern.every((name, offset) => segments[index + offset] === name),
  );
}

/** The exemption for this entry point, if any. Depends only on path and file. */
export function getRouteExemption(
  route: Pick<RawRouteEntry, 'path' | 'file'>,
): RouteExemption | null {
  const pathSegments = segmentsOf(route.path);
  const fileSegments = segmentsOf(route.file);
  for (const candidate of EXEMPT_SEGMENTS) {
    if (
      containsRun(pathSegments, candidate.segments) ||
      containsRun(fileSegments, candidate.segments)
    ) {
      return { reason: candidate.reason, skip: 'all' };
    }
  }
  return null;
}

export function isSkipped(exemption: RouteExemption, id: CheckId): boolean {
  return exemption.skip === 'all' || exemption.skip.includes(id);
}

export function isExemptRoute(route: RouteEntry): boolean {
  return getRouteExemption(route) !== null;
}

/** A check the author waived with a comment. */
export interface Suppression {
  id: string;
  /** Line the comment is on. */
  declaredAt: number;
  reason: string | null;
  scope: 'file' | 'next-line' | 'line';
}

const DIRECTIVE =
  /(?:\/\/|\/\*|\*)\s*autotel-map-disable(?<scope>-next-line|-line)?(?:\s+(?<ids>[a-z*-]+(?:\s*,\s*[a-z*-]+)*))?(?:\s*--\s*(?<reason>.*?))?\s*(?:\*\/)?\s*$/;

/** Every `autotel-map-disable` comment in a file, indexed for lookup. */
export function collectSuppressions(sourceText: string): {
  file: (id: string) => Suppression | undefined;
  at: (id: string, line: number) => Suppression | undefined;
  unknown: (known: readonly string[]) => Suppression[];
} {
  const all: Suppression[] = [];
  const lines = sourceText.split('\n');

  for (const [index, text] of lines.entries()) {
    const match = DIRECTIVE.exec(text);
    if (!match) continue;
    const scope =
      match.groups?.['scope'] === '-next-line'
        ? 'next-line'
        : match.groups?.['scope'] === '-line'
          ? 'line'
          : 'file';
    const reason = match.groups?.['reason']?.trim() || null;
    const ids = (match.groups?.['ids'] ?? '*')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    for (const id of ids) {
      all.push({ id, declaredAt: index + 1, reason, scope });
    }
  }

  const matches = (suppression: Suppression, id: string): boolean =>
    suppression.id === '*' || suppression.id === id;

  return {
    file: (id) =>
      all.find(
        (suppression) =>
          suppression.scope === 'file' && matches(suppression, id),
      ),
    at: (id, line) =>
      all.find(
        (suppression) =>
          matches(suppression, id) &&
          ((suppression.scope === 'next-line' &&
            suppression.declaredAt + 1 === line) ||
            (suppression.scope === 'line' && suppression.declaredAt === line)),
      ),
    unknown: (known) =>
      all.filter(
        (suppression) =>
          suppression.id !== '*' && !known.includes(suppression.id),
      ),
  };
}

export function suppressionMessage(suppression: Suppression): string {
  return suppression.reason
    ? `disabled: ${suppression.reason}`
    : 'disabled by autotel-map-disable';
}

/** How many checks on this entry point were waived by a comment. */
export function countSuppressed(route: RouteEntry): number {
  return Object.values(route.checks).filter((check) => check?.suppressed)
    .length;
}
