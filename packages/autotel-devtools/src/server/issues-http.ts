// HTTP surface for issues: list and inspect, change status, send now, and
// manage destinations, automations and run history. Every route sits behind
// the same loopback/Origin guard as the other read-back routes: issues carry
// stack traces and request data, and destinations carry credentials.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  redactDestination,
  type Automation,
  type Destination,
  type IssueStatus,
} from '../issues';
import { allowSensitiveRequest } from './origin-guard';
import { readJsonBody, sendJson } from './otlp';
import type { DevtoolsServer } from './server';

const DAY = 86_400_000;
const STATUSES = new Set<IssueStatus>(['active', 'resolved', 'ignored']);
const REDACTED = '••••';

const REQUIRED: Record<Destination['type'], string[]> = {
  webhook: ['url'],
  'claude-code': ['routineId', 'token'],
  cursor: ['url'],
  devin: ['orgId', 'token'],
  slack: ['url'],
  pagerduty: ['routingKey'],
};
const SECRET_FIELDS = ['secret', 'token', 'authorization', 'routingKey', 'url'];

class BadRequest extends Error {}

function isRedacted(value: string): boolean {
  try {
    return decodeURIComponent(value).includes(REDACTED);
  } catch {
    return value.includes(REDACTED);
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequest('Expected a JSON object');
  }
  return value as Record<string, unknown>;
}

function isHttpsOrLoopback(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' ||
      (parsed.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))
    );
  } catch {
    return false;
  }
}

/**
 * Validate a destination, keeping stored credentials when the client sends
 * back the redacted placeholder it was shown.
 */
function parseDestination(
  body: Record<string, unknown>,
  existing: Destination | undefined,
): Destination {
  const type = body.type as Destination['type'];
  if (!(type in REQUIRED))
    throw new BadRequest(`Unknown destination type: ${String(type)}`);
  const merged: Record<string, unknown> = { ...body };
  for (const field of SECRET_FIELDS) {
    const value = merged[field];
    // URLs carry the placeholder percent-encoded in their query.
    if (typeof value === 'string' && isRedacted(value) && existing) {
      merged[field] = (existing as unknown as Record<string, unknown>)[field];
    }
  }
  // Headers come back redacted one by one: keep each stored value the client
  // left as the placeholder, take any it changed or added.
  if (merged.headers !== undefined) {
    const sent = record(merged.headers);
    const stored = existing?.type === 'webhook' ? (existing.headers ?? {}) : {};
    merged.headers = Object.fromEntries(
      Object.entries(sent)
        .map(([name, value]) => [
          name,
          typeof value === 'string' && value.includes(REDACTED)
            ? stored[name]
            : String(value),
        ])
        .filter(([, value]) => value !== undefined),
    );
  }
  for (const field of REQUIRED[type]) {
    if (typeof merged[field] !== 'string' || merged[field] === '') {
      throw new BadRequest(`${type} destination needs ${field}`);
    }
  }
  if (typeof merged.url === 'string' && !isHttpsOrLoopback(merged.url)) {
    throw new BadRequest('Destination URL must be https (or http on loopback)');
  }
  return {
    ...merged,
    type,
    id: typeof merged.id === 'string' && merged.id ? merged.id : randomUUID(),
    name: typeof merged.name === 'string' && merged.name ? merged.name : type,
  } as Destination;
}

function parseAutomation(
  body: Record<string, unknown>,
  devtools: DevtoolsServer,
): Automation {
  const trigger = record(body.trigger);
  let parsedTrigger: Automation['trigger'];
  if (trigger.type === 'threshold') {
    const count = Number(trigger.count);
    if (!Number.isInteger(count) || count < 1)
      throw new BadRequest('threshold count must be an integer >= 1');
    parsedTrigger = { type: 'threshold', count };
  } else if (trigger.type === 'recurrence') {
    const inactiveMs = Number(trigger.inactiveMs);
    // Cloudflare's bounds: one hour to 365 days.
    if (!(inactiveMs >= 3_600_000 && inactiveMs <= 365 * DAY)) {
      throw new BadRequest(
        'recurrence inactiveMs must be between 1 hour and 365 days',
      );
    }
    parsedTrigger = { type: 'recurrence', inactiveMs };
  } else {
    throw new BadRequest('trigger.type must be threshold or recurrence');
  }
  const destinationId = String(body.destinationId ?? '');
  if (!devtools.issueEngine.hasDestination(destinationId)) {
    throw new BadRequest(`Unknown destination: ${destinationId}`);
  }
  return {
    id: typeof body.id === 'string' && body.id ? body.id : randomUUID(),
    name:
      typeof body.name === 'string' && body.name
        ? body.name
        : parsedTrigger.type,
    trigger: parsedTrigger,
    destinationId,
    enabled: body.enabled !== false,
    ...(Array.isArray(body.services)
      ? {
          services: body.services.filter(
            (s): s is string => typeof s === 'string',
          ),
        }
      : {}),
  };
}

/** Handles `/api/issues*`, `/api/issue-*`. Returns false for any other URL. */
export async function handleIssueRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  devtools: DevtoolsServer,
  loopbackOnly: boolean,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://devtools.local');
  const path = url.pathname;
  if (!path.startsWith('/api/issue')) return false;
  if (!allowSensitiveRequest(req.headers, loopbackOnly)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return true;
  }
  const store = devtools.issueStore;
  const now = Date.now();
  const window = {
    start: Number(url.searchParams.get('start') ?? now - DAY),
    end: Number(url.searchParams.get('end') ?? now),
  };

  try {
    const issueMatch = /^\/api\/issues\/([^/]+)(\/status|\/send)?$/.exec(path);

    if (req.method === 'GET' && path === '/api/issues') {
      const status = url.searchParams.get('status') as IssueStatus | null;
      sendJson(res, 200, {
        issues: store.list({
          ...window,
          ...(status && STATUSES.has(status) ? { status } : {}),
          ...(url.searchParams.get('service')
            ? { service: url.searchParams.get('service')! }
            : {}),
          limit: Number(url.searchParams.get('limit') ?? 100),
          ...(url.searchParams.get('quietMs')
            ? { quietMs: Number(url.searchParams.get('quietMs')) }
            : {}),
        }),
      });
      return true;
    }

    if (issueMatch) {
      const fingerprint = decodeURIComponent(issueMatch[1]!);
      const action = issueMatch[2];
      if (!store.getRow(fingerprint)) {
        sendJson(res, 404, { error: 'Issue not found' });
        return true;
      }
      if (req.method === 'GET' && !action) {
        const issue = store.get(fingerprint, window.start, window.end)!;
        sendJson(res, 200, {
          ...devtools.issueEngine.payload(issue, 'manual'),
          occurrences: store.occurrences(fingerprint).slice(-20).reverse(),
          runs: store.runs({ fingerprint }),
        });
        return true;
      }
      if (req.method === 'POST' && action === '/status') {
        const status = record(await readJsonBody(req)).status as IssueStatus;
        if (!STATUSES.has(status))
          throw new BadRequest('status must be active, resolved or ignored');
        store.setStatus(fingerprint, status, now);
        sendJson(res, 200, { fingerprint, status });
        return true;
      }
      if (req.method === 'POST' && action === '/send') {
        const destinationId = String(
          record(await readJsonBody(req)).destinationId ?? '',
        );
        if (!devtools.issueEngine.hasDestination(destinationId)) {
          throw new BadRequest(`Unknown destination: ${destinationId}`);
        }
        const run = await devtools.issueEngine.send(fingerprint, destinationId);
        sendJson(res, 200, { run });
        return true;
      }
    }

    if (path === '/api/issue-destinations' && req.method === 'GET') {
      sendJson(res, 200, {
        destinations: store.listDestinations().map(redactDestination),
      });
      return true;
    }
    if (path === '/api/issue-destinations' && req.method === 'POST') {
      const body = record(await readJsonBody(req));
      const existing =
        typeof body.id === 'string' ? store.getDestination(body.id) : undefined;
      const destination = parseDestination(body, existing);
      store.saveDestination(destination);
      sendJson(res, 200, { destination: redactDestination(destination) });
      return true;
    }
    const destinationMatch = /^\/api\/issue-destinations\/([^/]+)$/.exec(path);
    if (destinationMatch && req.method === 'DELETE') {
      const id = decodeURIComponent(destinationMatch[1]!);
      if (store.listAutomations().some((a) => a.destinationId === id)) {
        throw new BadRequest('Destination is used by an automation');
      }
      sendJson(res, store.deleteDestination(id) ? 200 : 404, { id });
      return true;
    }

    if (path === '/api/issue-automations' && req.method === 'GET') {
      sendJson(res, 200, { automations: store.listAutomations() });
      return true;
    }
    if (path === '/api/issue-automations' && req.method === 'POST') {
      const automation = parseAutomation(
        record(await readJsonBody(req)),
        devtools,
      );
      store.saveAutomation(automation);
      sendJson(res, 200, { automation });
      return true;
    }
    const automationMatch = /^\/api\/issue-automations\/([^/]+)$/.exec(path);
    if (automationMatch && req.method === 'DELETE') {
      const id = decodeURIComponent(automationMatch[1]!);
      sendJson(res, store.deleteAutomation(id) ? 200 : 404, { id });
      return true;
    }

    if (path === '/api/issue-runs' && req.method === 'GET') {
      sendJson(res, 200, {
        runs: store.runs({
          ...(url.searchParams.get('fingerprint')
            ? { fingerprint: url.searchParams.get('fingerprint')! }
            : {}),
          ...(url.searchParams.get('automationId')
            ? { automationId: url.searchParams.get('automationId')! }
            : {}),
        }),
      });
      return true;
    }
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }

  sendJson(res, 404, { error: 'Not found' });
  return true;
}
