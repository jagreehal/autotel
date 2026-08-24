/**
 * Check severity level
 */
export type CheckLevel = 'error' | 'warning' | 'info';

/**
 * Check result status
 */
export type CheckStatus = 'ok' | 'warn' | 'error' | 'skip';

/**
 * Fix information for a check
 */
export interface CheckFix {
  cmd: string;
  description: string;
}

/**
 * Standardized check result
 */
export interface Check {
  id: string;
  title: string;
  level: CheckLevel;
  status: CheckStatus;
  message: string;
  details?: string[];
  fix?: CheckFix;
  /**
   * Describes the setup rather than judging it, so it never affects the exit
   * code. A `warn` here reports a fact the user cannot act on — the toolchain
   * observes no file writes in any project — and failing CI on that is noise.
   */
  informational?: true;
}

/**
 * Check summary counts
 */
export interface CheckSummary {
  ok: number;
  warnings: number;
  errors: number;
  skipped: number;
}

/**
 * Doctor output structure
 */
export interface DoctorResult {
  project: string;
  checks: Check[];
  summary: CheckSummary;
}

/**
 * Check definition for registration
 */
export interface CheckDefinition {
  id: string;
  title: string;
  level: CheckLevel;
  description: string;
}
