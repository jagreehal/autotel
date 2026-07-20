import type { RunEvent } from './types';

export interface IngestBody {
  events: RunEvent[];
}

export interface ParseIngestResult {
  ok: true;
  body: IngestBody;
}

export interface ParseIngestError {
  ok: false;
  error: string;
}

export function parseIngestBody(
  raw: unknown,
  opts?: { allowedTools?: string[] },
): ParseIngestResult | ParseIngestError {
  if (!raw || typeof raw !== 'object' || !('events' in raw)) {
    return { ok: false, error: 'missing events array' };
  }

  const events = (raw as IngestBody).events;
  if (!Array.isArray(events)) {
    return { ok: false, error: 'events must be an array' };
  }

  for (const event of events) {
    if (!event || typeof event !== 'object') {
      return { ok: false, error: 'invalid event object' };
    }
    if (typeof event.tool !== 'string' || typeof event.command !== 'string') {
      return { ok: false, error: 'event missing tool or command' };
    }
    if (opts?.allowedTools && !opts.allowedTools.includes(event.tool)) {
      return { ok: false, error: `tool not allowed: ${event.tool}` };
    }
  }

  return { ok: true, body: { events } };
}
