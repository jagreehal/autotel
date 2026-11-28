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

/**
 * `text` with control characters written as escapes (`\r`, `\n`, `\u001b`),
 * the way JSON shows them. Span names, attributes and log bodies carry what a
 * client sent: a user agent holding `\r\u001b[2K` would otherwise erase the
 * line it is printed on and write a fake one in its place.
 */
export function escapeControl(text: string): string {
  // oxlint-disable-next-line no-control-regex -- matching control characters is the point
  return text.replaceAll(/[\u0000-\u001F\u007F-\u009F]/g, (char) => {
    const json = JSON.stringify(char).slice(1, -1);
    return json.length > 1
      ? json
      : `\\u${char.codePointAt(0)!.toString(16).padStart(4, '0')}`;
  });
}
