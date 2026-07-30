/**
 * Types for `autotel map` — the static observability map.
 *
 * The map answers one question per entry point: if this breaks in production,
 * what context will you have? Rules encode the answer; the score is a weighted
 * roll-up of the rules that failed.
 */

/** Frameworks the scan knows how to find entry points in. */
export type Framework =
  | 'next'
  | 'nitro'
  | 'tanstack-start'
  | 'sveltekit'
  | 'hono'
  | 'express'
  | 'fastify'
  | 'elysia'
  | 'cloudflare';

/**
 * Entry-point shape as found on disk, before any check runs.
 *
 * Only server-side entry points are mapped. A rendered page has no span of its
 * own to carry context, so scoring one would move the number without pointing
 * at work anybody can do.
 */
export type RouteKind = 'api' | 'middleware' | 'server-fn' | 'page';

/** Entry-point kinds that own a server-side span and request event. */
export const HANDLER_KINDS: readonly RouteKind[] = [
  'api',
  'middleware',
  'server-fn',
];

/**
 * One rule the map runs.
 *
 * Requirements cost score points when they fail and land in
 * {@link RouteEntry.checks}; opportunities never cost points and land in
 * {@link RouteEntry.suggestions}.
 */
export type CheckId =
  | 'trace'
  | 'context'
  | 'structured-errors'
  | 'error-handling'
  | 'page-error-handling'
  | 'audit'
  | 'audit-coverage'
  | 'error-catalog'
  | 'genai'
  | 'validation'
  | 'redaction';

export interface SourceLocation {
  line: number;
  column: number;
}

export interface CheckEvidence {
  file: string;
  line: number;
  snippet?: string;
}

export interface CheckResult {
  status: 'pass' | 'fail' | 'n/a';
  message?: string;
  /**
   * The code that would make this check pass.
   *
   * Carried in the result rather than looked up by the renderer so that an
   * agent reading `autotel.map.json` gets the fix with the finding.
   */
  fix?: string;
  evidence?: CheckEvidence;
  /**
   * Turned off by an `autotel-map-disable` comment.
   *
   * Always paired with `status: 'n/a'`, so it costs no score. Kept as its own
   * field rather than inferred from the message: CI that wants to know how much
   * of a green score is suppressed should not have to parse prose.
   */
  suppressed?: true;
}

export interface Sensitivity {
  level: 'high' | 'medium' | 'none';
  reasons: string[];
}

/** Entry point extracted from the filesystem, before checks run. */
export interface RawRouteEntry {
  framework: Framework;
  kind: RouteKind;
  method: string | null;
  path: string;
  /** Repo-relative, POSIX separators — stable across machines in the map file. */
  file: string;
  handler: SourceLocation | null;
}

/** A scanned entry point with checks, sensitivity, and score attached. */
export interface RouteEntry extends RawRouteEntry {
  id: string;
  /** Requirement results. These, and only these, move the score. */
  checks: Partial<Record<CheckId, CheckResult>>;
  /**
   * Opportunity results — kept apart from {@link checks} so a suggestion is
   * never mistaken for a failure, by a reader or by a CI gate.
   */
  suggestions: Partial<Record<CheckId, CheckResult>>;
  sensitivity: Sensitivity;
  score: number;
}

/** The `autotel.map.json` shape written to disk. Public contract. */
export interface MapFile {
  version: 1;
  generatedAt: string;
  framework: Framework;
  projectName: string;
  score: number;
  routes: RouteEntry[];
}

export type Grade = 'excellent' | 'good' | 'needs-work' | 'at-risk';

/**
 * A suggestion whose work is one edit for the whole project.
 *
 * Kept out of {@link RouteEntry.suggestions} so it is never counted per entry
 * point: `attributeRedactor` is configured once, not once per handler.
 */
export interface ProjectSuggestion {
  id: CheckId;
  message: string;
  /** Where it was first noticed — a place to start reading, not the only fix. */
  evidence?: CheckEvidence;
}

export interface ScanSummary {
  instrumented: number;
  partial: number;
  dark: number;
  exempt: number;
  /** Checks turned off by an `autotel-map-disable` comment, across the project. */
  suppressedChecks: number;
}

export interface ScanResult {
  map: MapFile;
  grade: Grade;
  /** Opportunities that are one project-wide edit, not per-entry-point work. */
  suggestions: ProjectSuggestion[];
  /** Problems found while scanning — e.g. a disable comment naming an unknown check. */
  warnings: string[];
  summary: ScanSummary;
}
