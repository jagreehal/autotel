/**
 * Builds clickable editor deep-links from OpenTelemetry `code.*` span
 * attributes, closing the loop from a span back to its source.
 *
 * Supports both the legacy (`code.filepath`, `code.lineno`) and current
 * (`code.file.path`, `code.line.number`) OTel semantic conventions.
 */

export type EditorScheme = 'vscode' | 'cursor' | 'webstorm';

export interface CodeLocation {
  /** Absolute or relative source path, verbatim from the span. */
  filepath: string;
  line?: number;
  column?: number;
  functionName?: string;
  namespace?: string;
  /** Short, human-friendly label: `basename:line`. */
  display: string;
  /** Editor deep-link for the configured scheme. */
  href: string;
}

const FILE_KEYS = ['code.filepath', 'code.file.path'] as const;
const LINE_KEYS = ['code.lineno', 'code.line.number'] as const;
const COLUMN_KEYS = ['code.column', 'code.column.number'] as const;
const FUNCTION_KEYS = ['code.function', 'code.function.name'] as const;

function firstString(
  attributes: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const v = attributes[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function firstNumber(
  attributes: Record<string, unknown>,
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    const v = attributes[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
      return Number(v);
    }
  }
  return undefined;
}

function buildHref(
  scheme: EditorScheme,
  filepath: string,
  line?: number,
  column?: number,
): string {
  if (scheme === 'webstorm') {
    let href = `jetbrains://web-storm/navigate/reference?path=${encodeURIComponent(filepath)}`;
    if (line !== undefined) href += `&line=${line}`;
    return href;
  }
  // vscode / cursor share the `<scheme>://file/<path>:<line>:<col>` shape.
  // The path must not have a leading slash after `file/`.
  let href = `${scheme}://file/${filepath.replace(/^\//, '')}`;
  if (line !== undefined) {
    href += `:${line}`;
    if (column !== undefined) href += `:${column}`;
  }
  return href;
}

export function buildCodeLocation(
  attributes: Record<string, unknown>,
  scheme: EditorScheme,
): CodeLocation | null {
  const filepath = firstString(attributes, FILE_KEYS);
  if (!filepath) return null;

  const line = firstNumber(attributes, LINE_KEYS);
  const column = firstNumber(attributes, COLUMN_KEYS);
  const functionName = firstString(attributes, FUNCTION_KEYS);
  const namespace = firstString(attributes, ['code.namespace']);

  const basename = filepath.split(/[/\\]/).pop() || filepath;
  const display = line === undefined ? basename : `${basename}:${line}`;

  return {
    filepath,
    line,
    column,
    functionName,
    namespace,
    display,
    href: buildHref(scheme, filepath, line, column),
  };
}
