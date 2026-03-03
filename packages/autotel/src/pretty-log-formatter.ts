import type { CanonicalLogLineEvent } from './processors/canonical-log-line-processor';

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const GRAY = '\x1b[90m';

const LEVEL_COLORS: Record<string, string> = {
  debug: GRAY,
  info: GREEN,
  warn: YELLOW,
  error: RED,
};

/** Internal OTel attributes to skip in pretty output. */
const SKIP_PREFIXES = [
  'telemetry.',
  'otel.',
  'process.',
  'os.',
  'host.',
  'service.',
  'autotel.',
];

const SKIP_KEYS = new Set([
  'operation',
  'traceId',
  'spanId',
  'correlationId',
  'duration_ms',
  'duration',
  'status_code',
  'status_message',
  'timestamp',
  'http.request.method',
  'url.path',
  'http.route',
  'http.response.status_code',
]);

function useColor(): boolean {
  if (typeof process !== 'undefined') {
    if (process.env.NO_COLOR) return false;
    if (process.env.FORCE_COLOR) return true;
    if (process.stdout?.isTTY) return true;
  }
  return false;
}

function c(color: string, text: string): string {
  return useColor() ? `${color}${text}${RESET}` : text;
}

/**
 * Format milliseconds into a human-readable duration string.
 *
 * @example
 * formatDuration(45)     // "45ms"
 * formatDuration(1234)   // "1.2s"
 * formatDuration(65000)  // "1m 5s"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) {
    const seconds = ms / 1000;
    return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
  }
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-GB', { hour12: false });
  } catch {
    return iso.slice(11, 19);
  }
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Group flat dot-notation attributes into a nested tree for pretty display.
 * e.g. { 'user.id': '1', 'user.plan': 'pro' } → { user: { id: '1', plan: 'pro' } }
 */
function groupAttributes(
  event: Record<string, unknown>,
): Record<string, unknown> {
  const tree: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(event)) {
    if (SKIP_KEYS.has(key)) continue;
    if (SKIP_PREFIXES.some((p) => key.startsWith(p))) continue;
    if (value == null || value === '') continue;

    const parts = key.split('.');
    if (parts.length === 1) {
      tree[key] = value;
    } else {
      let current = tree;
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i]!;
        if (!(part in current) || typeof current[part] !== 'object') {
          current[part] = {};
        }
        current = current[part] as Record<string, unknown>;
      }
      current[parts[parts.length - 1]!] = value;
    }
  }

  return tree;
}

function renderTree(
  obj: Record<string, unknown>,
  indent: string,
  isLast: boolean[],
): string[] {
  const lines: string[] = [];
  const entries = Object.entries(obj);

  entries.forEach(([key, value], idx) => {
    const last = idx === entries.length - 1;
    const connector = last ? '\u2514\u2500' : '\u251c\u2500';
    const prefix = indent + connector + ' ';

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>;
      const flatValues = Object.entries(nested).filter(
        ([, v]) => typeof v !== 'object' || v === null,
      );
      const nestedObjs = Object.entries(nested).filter(
        ([, v]) => typeof v === 'object' && v !== null && !Array.isArray(v),
      );

      if (nestedObjs.length === 0) {
        const inline = flatValues
          .map(([k, v]) => `${c(CYAN, k)}=${formatValue(v)}`)
          .join(' ');
        lines.push(`${prefix}${c(BOLD, key)}: ${inline}`);
      } else {
        lines.push(`${prefix}${c(BOLD, key)}:`);
        const nextIndent = indent + (last ? '   ' : '\u2502  ');
        lines.push(...renderTree(nested, nextIndent, [...isLast, last]));
      }
    } else {
      lines.push(`${prefix}${c(CYAN, key)}: ${c(DIM, formatValue(value))}`);
    }
  });

  return lines;
}

/**
 * Format a canonical log line event as a pretty tree for development output.
 */
export function formatPrettyLogLine(ctx: CanonicalLogLineEvent): string {
  const { event, level, message } = ctx;

  const timestamp = formatTime(String(event.timestamp ?? ''));
  const service = event['service.name'] || event.service || '';
  const method = event['http.request.method'] || '';
  const path = event['http.route'] || event['url.path'] || '';
  const status = event['http.response.status_code'] || event.status_code || '';
  const durationMs = Number(event.duration_ms ?? 0);
  const duration = formatDuration(durationMs);

  const levelColor = LEVEL_COLORS[level] ?? '';
  const levelStr = c(levelColor, level.toUpperCase().padEnd(5));

  const parts = [c(DIM, timestamp), levelStr];
  if (service) parts.push(c(DIM, `[${service}]`));
  if (method) parts.push(c(BOLD, String(method)));
  if (path) parts.push(String(path));
  if (status) {
    const statusNum = Number(status);
    const statusColor =
      statusNum >= 500 ? RED : statusNum >= 400 ? YELLOW : GREEN;
    parts.push(c(statusColor, String(status)));
  }
  parts.push(c(DIM, `in ${duration}`));

  const header = parts.join(' ');

  const tree = groupAttributes(event);
  if (Object.keys(tree).length === 0) {
    return header;
  }

  const treeLines = renderTree(tree, '  ', []);
  return [header, ...treeLines].join('\n');
}
