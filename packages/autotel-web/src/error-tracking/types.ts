/**
 * Structured error types for autotel-web error tracking.
 * Compatible with PostHog's $exception_list format and OTel semantic conventions.
 */

import type { StringRedactor } from './redact-values';

export interface StackFrame {
  /** Source filename (e.g., "app.js", "https://example.com/app.js") */
  filename?: string;
  /** Function name */
  function?: string;
  /** Line number (1-indexed) */
  lineno?: number;
  /** Column number (1-indexed) */
  colno?: number;
  /** Absolute path / full URL */
  abs_path?: string;
  /** Whether this frame is from application code (vs library) */
  in_app?: boolean;
  /** Platform identifier */
  platform?: string;
}

export interface ExceptionMechanism {
  /** How the error was captured */
  type: 'onerror' | 'onunhandledrejection' | 'console.error' | 'manual' | 'generic';
  /** Whether the error was explicitly caught by user code */
  handled: boolean;
}

export interface ExceptionRecord {
  /** Error class name (e.g., "TypeError", "RangeError") */
  type: string;
  /** Error message */
  value: string;
  /** How the error was captured */
  mechanism: ExceptionMechanism;
  /** Parsed stack trace */
  stacktrace?: { frames: StackFrame[] };
}

/**
 * List of exceptions, ordered from root cause to outermost.
 * Supports error.cause chains.
 */
export type ExceptionList = ExceptionRecord[];

export interface SuppressionRule {
  /** Field to match against */
  key: 'type' | 'value';
  /** Match operator */
  operator: 'exact' | 'contains' | 'regex';
  /** Value or pattern to match */
  value: string;
}

export interface RateLimitConfig {
  /** Max exceptions per type within the window (default: 10) */
  maxPerType: number;
  /** Time window in milliseconds (default: 10000) */
  windowMs: number;
}

export interface ErrorTrackingConfig {
  /** Rate limit per exception type */
  rateLimit?: RateLimitConfig;
  /** Suppression rules to filter known noise */
  suppressionRules?: SuppressionRule[];
  /** Capture console.error as exceptions (default: false) */
  captureConsoleErrors?: boolean;
  /** Skip autocapture if window.posthog is detected (default: true) */
  deferToPostHog?: boolean;
  /** Debug logging */
  debug?: boolean;
  /** String redactor for PII in error messages and stack traces */
  redactor?: StringRedactor;
}
