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
