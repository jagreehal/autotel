/**
 * What the pretty console exporters share: their result codes, the ANSI
 * colours, and when to use them. Zero dependencies, so neither exporter pulls
 * `@opentelemetry/core` in for two constants.
 */

export const ExportResultCode = {
  SUCCESS: 0,
  FAILED: 1,
} as const;

/** The callback result an exporter reports. */
export interface ExportResult {
  code: number;
  error?: Error;
}

const ANSI = {
  reset: '\u001B[0m',
  bold: '\u001B[1m',
  dim: '\u001B[2m',
  green: '\u001B[32m',
  red: '\u001B[31m',
  yellow: '\u001B[33m',
  blue: '\u001B[34m',
  cyan: '\u001B[36m',
  gray: '\u001B[90m',
} as const;

export type AnsiColor = Exclude<keyof typeof ANSI, 'reset'>;

/** Colours unless told otherwise, and only on a terminal. */
export function useColors(option: boolean | undefined): boolean {
  return option ?? process.stdout?.isTTY ?? false;
}

export function paint(colors: boolean, color: AnsiColor, text: string): string {
  return colors ? `${ANSI[color]}${text}${ANSI.reset}` : text;
}
