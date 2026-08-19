import type { CanonicalLogLineEvent } from './processors/canonical-log-line-processor';
import type { UnknownRecord } from './values';
import { asBoolean, asNumber, asRecord, asString, hasProcess } from './values';

const RESET = '\u001B[0m';
const DIM = '\u001B[2m';
const BOLD = '\u001B[1m';
const RED = '\u001B[31m';
const YELLOW = '\u001B[33m';
const GREEN = '\u001B[32m';
const CYAN = '\u001B[36m';
const GRAY = '\u001B[90m';

const LEVEL_COLORS = new Map<string, string>([
  ['debug', GRAY],
  ['info', GREEN],
  ['warn', YELLOW],
  ['error', RED],
]);

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
  if (!hasProcess()) return false;
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return process.stdout?.isTTY === true;
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
  const text = asString(value);
  if (text !== undefined) return text;
  const scalar = asNumber(value) ?? asBoolean(value);
  if (scalar !== undefined) return String(scalar);
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
function groupAttributes(event: UnknownRecord): UnknownRecord {
  const tree: UnknownRecord = {};

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
        const branch = asRecord(current[part]);
        if (branch) {
          current = branch;
        } else {
          const created: UnknownRecord = {};
          current[part] = created;
          current = created;
        }
      }
      current[parts.at(-1)!] = value;
    }
  }

  return tree;
}

function renderTree(
  obj: UnknownRecord,
  indent: string,
  isLast: boolean[],
): string[] {
  const lines: string[] = [];
  const entries = Object.entries(obj);

  for (const [idx, [key, value]] of entries.entries()) {
    const last = idx === entries.length - 1;
    const connector = last ? '\u2514\u2500' : '\u251C\u2500';
    const prefix = indent + connector + ' ';

    const nested = asRecord(value);
    if (nested) {
      const nestedObjs = Object.entries(nested).filter(([, v]) => asRecord(v));
      const flatValues = Object.entries(nested).filter(
        ([, v]) => asRecord(v) === undefined,
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
  }

  return lines;
}

/**
 * Format a canonical log line event as a pretty tree for development output.
 */
export function formatPrettyLogLine(ctx: CanonicalLogLineEvent): string {
  const { event, level } = ctx;

  const timestamp = formatTime(String(event.timestamp ?? ''));
  const service = event['service.name'] || event.service || '';
  const method = event['http.request.method'] || '';
  const path = event['http.route'] || event['url.path'] || '';
  // HTTP status only. `event.status_code` is the OTel SpanStatusCode
  // (0 unset, 1 ok, 2 error), so falling back to it renders a non-HTTP span as
  // `1` in the status slot and colours an errored span green.
  const status = event['http.response.status_code'] || '';
  const durationMs = Number(event.duration_ms ?? 0);
  const duration = formatDuration(durationMs);

  const levelColor = LEVEL_COLORS.get(level) ?? '';
  const levelStr = c(levelColor, level.toUpperCase().padEnd(5));

  const parts = [c(DIM, timestamp), levelStr];
  if (service) parts.push(c(DIM, `[${service}]`));
  if (method) parts.push(c(BOLD, String(method)));
  if (path) parts.push(String(path));
  // Non-HTTP spans have no method or route to identify them, so name the
  // operation instead. The level already carries whether it failed.
  if (!method && !path && event.operation) {
    parts.push(c(BOLD, String(event.operation)));
  }
  if (status) {
    const statusNum = Number(status);
    const statusColor =
      statusNum >= 500 ? RED : statusNum >= 400 ? YELLOW : GREEN;
    parts.push(c(statusColor, String(status)));
  }
  // `autotel.log.level` overrides the level the span status would have implied,
  // so an errored span can print as INFO. `status_code` is in SKIP_KEYS too, so
  // without this marker the failure appears nowhere in the output.
  if (Number(event.status_code) === 2 && level !== 'error') {
    parts.push(c(RED, 'ERROR'));
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
