import { z } from 'zod';

const RELATIVE_RE = /^now([+-])(\d+)([smhdwMy])$/;

const UNIT_TO_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
  M: 30 * 24 * 60 * 60 * 1000,
  y: 365 * 24 * 60 * 60 * 1000,
};

export const timeWindowSchema = z.object({
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
});

export type TimeWindowInput = z.infer<typeof timeWindowSchema>;

export function parseTimestamp(input: string, nowMs = Date.now()): number {
  if (input === 'now') return nowMs;

  const rel = RELATIVE_RE.exec(input);
  if (rel) {
    const op = rel[1];
    const amount = Number(rel[2]);
    const unit = rel[3];
    const ms = UNIT_TO_MS[unit];
    if (!Number.isFinite(amount) || !ms) {
      throw new Error(`Invalid relative time expression: ${input}`);
    }
    return op === '-' ? nowMs - amount * ms : nowMs + amount * ms;
  }

  const parsed = Date.parse(input);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid timestamp: ${input}`);
  }

  return parsed;
}

export function resolveTimeRange(params: {
  from?: string;
  to?: string;
  lookbackMinutes?: number;
  defaultLookbackMinutes?: number;
}): { startTimeUnixMs?: number; endTimeUnixMs?: number } {
  const nowMs = Date.now();
  const defaultLookbackMinutes = params.defaultLookbackMinutes ?? 60;

  if (params.from || params.to) {
    const end = params.to ? parseTimestamp(params.to, nowMs) : nowMs;
    const start = params.from
      ? parseTimestamp(params.from, nowMs)
      : end - defaultLookbackMinutes * 60 * 1000;

    if (start > end) {
      throw new Error('Invalid time range: `from` must be earlier than `to`.');
    }

    return { startTimeUnixMs: start, endTimeUnixMs: end };
  }

  if (params.lookbackMinutes !== undefined) {
    return {
      startTimeUnixMs: nowMs - params.lookbackMinutes * 60 * 1000,
      endTimeUnixMs: nowMs,
    };
  }

  return {};
}
