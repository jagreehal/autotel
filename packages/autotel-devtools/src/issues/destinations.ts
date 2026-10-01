// Where an issue goes, and the exact request each destination expects.
// Browser-safe: `fetch` and `crypto.subtle` are globals in Node 24 and browsers.

import type { Issue } from './group';

export type Destination =
  /** Any HTTPS endpoint. Signed with HMAC-SHA256 when `secret` is set. */
  | {
      type: 'webhook';
      id: string;
      name: string;
      url: string;
      secret?: string;
      headers?: Record<string, string>;
    }
  /** A Claude Code routine's API trigger (`/fire`). */
  | {
      type: 'claude-code';
      id: string;
      name: string;
      routineId: string;
      token: string;
    }
  /** A Cursor automation webhook trigger. */
  | {
      type: 'cursor';
      id: string;
      name: string;
      url: string;
      authorization?: string;
    }
  /** Devin v3: creates a session in the organization. */
  | {
      type: 'devin';
      id: string;
      name: string;
      orgId: string;
      token: string;
      repos?: string[];
      playbookId?: string;
    }
  /** Slack incoming webhook. */
  | { type: 'slack'; id: string; name: string; url: string }
  /** PagerDuty Events API v2. */
  | { type: 'pagerduty'; id: string; name: string; routingKey: string };

export type DestinationType = Destination['type'];

export type SendTrigger = 'threshold' | 'recurrence' | 'manual' | 'reopened';

/** What every destination is sent: the issue plus the context to fix it. */
export interface IssuePayload {
  trigger: SendTrigger;
  issue: Issue;
  /** Latest occurrence's trace, compacted by the caller, if any. */
  trace?: unknown;
  /** Logs around the latest occurrence. */
  logs?: Array<{ timestamp: number; severity?: string; body: string }>;
  /** Link back to the issue in devtools, when the sender knows one. */
  url?: string;
}

/** Credentials never leave the server: this is what an API response shows. */
export function redactDestination(destination: Destination): Destination {
  const hidden = '••••';
  switch (destination.type) {
    case 'webhook':
      return {
        ...destination,
        url: redactQuery(destination.url, hidden),
        ...(destination.secret ? { secret: hidden } : {}),
        // Custom headers are how webhooks authenticate (Authorization, API
        // keys): every value is a credential as far as a response is concerned.
        ...(destination.headers
          ? {
              headers: Object.fromEntries(
                Object.keys(destination.headers).map((name) => [name, hidden]),
              ),
            }
          : {}),
      };
    case 'claude-code':
    case 'devin':
      return { ...destination, token: hidden };
    case 'cursor':
      return {
        ...destination,
        url: redactQuery(destination.url, hidden),
        ...(destination.authorization ? { authorization: hidden } : {}),
      };
    case 'slack':
      return { ...destination, url: destination.url.replace(/[^/]+$/, hidden) };
    case 'pagerduty':
      return { ...destination, routingKey: hidden };
  }
}

/** Query values often carry tokens (`?key=`, `?token=`): keep names, hide values. */
function redactQuery(url: string, hidden: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.search) return url;
    for (const key of [...parsed.searchParams.keys()]) {
      parsed.searchParams.set(key, hidden);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/** A plain-text brief for agents and chat: what broke, where, how often, and the stack. */
export function issueBrief(payload: IssuePayload): string {
  const { issue } = payload;
  const lines = [
    `Issue ${issue.fingerprint} (${payload.trigger}): ${issue.title}`,
    `Service: ${issue.service}${issue.culprit ? ` — at ${issue.culprit}` : ''}`,
    `Occurrences: ${issue.count}, first ${new Date(issue.firstSeen).toISOString()}, last ${new Date(issue.lastSeen).toISOString()}`,
  ];
  if (issue.versions.length > 0)
    lines.push(`Versions: ${issue.versions.join(', ')}`);
  const { users, accounts, sessions } = issue.affected;
  if (users + accounts + sessions > 0) {
    lines.push(
      `Affected: ${users} users, ${accounts} accounts, ${sessions} sessions`,
    );
  }
  if (issue.sampleTraceIds.length > 0) {
    lines.push(`Traces: ${issue.sampleTraceIds.join(', ')}`);
  }
  if (payload.url) lines.push(`Details: ${payload.url}`);
  if (issue.latestStack) lines.push('', 'Stack trace:', issue.latestStack);
  if (payload.logs && payload.logs.length > 0) {
    lines.push('', 'Logs around the latest occurrence:');
    for (const log of payload.logs.slice(-20)) {
      lines.push(
        `${new Date(log.timestamp).toISOString()} ${log.severity ?? ''} ${log.body}`.trim(),
      );
    }
  }
  return lines.join('\n');
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export interface OutgoingRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** Build the request a destination expects. Pure apart from HMAC signing. */
export async function buildRequest(
  destination: Destination,
  payload: IssuePayload,
  now: number = Date.now(),
): Promise<OutgoingRequest> {
  const json = { 'content-type': 'application/json' };
  switch (destination.type) {
    case 'webhook': {
      const body = JSON.stringify({ ...payload, sentAt: now });
      const headers: Record<string, string> = {
        ...json,
        ...destination.headers,
      };
      if (destination.secret) {
        // Timestamp inside the signed material, so a captured request cannot
        // be replayed later with a fresh header.
        const timestamp = String(Math.floor(now / 1000));
        headers['x-autotel-timestamp'] = timestamp;
        headers['x-autotel-signature'] =
          `sha256=${await hmacHex(destination.secret, `${timestamp}.${body}`)}`;
      }
      return { url: destination.url, headers, body };
    }
    case 'claude-code':
      return {
        url: `https://api.anthropic.com/v1/claude_code/routines/${encodeURIComponent(destination.routineId)}/fire`,
        headers: {
          ...json,
          authorization: `Bearer ${destination.token}`,
          'anthropic-beta': 'experimental-cc-routine-2026-04-01',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ text: issueBrief(payload) }),
      };
    case 'cursor':
      return {
        url: destination.url,
        headers: {
          ...json,
          ...(destination.authorization
            ? { authorization: destination.authorization }
            : {}),
        },
        body: JSON.stringify({ ...payload, text: issueBrief(payload) }),
      };
    case 'devin':
      return {
        url: `https://api.devin.ai/v3/organizations/${encodeURIComponent(destination.orgId)}/sessions`,
        headers: { ...json, authorization: `Bearer ${destination.token}` },
        body: JSON.stringify({
          prompt: issueBrief(payload),
          title: `Fix: ${payload.issue.title}`.slice(0, 120),
          ...(destination.repos?.length ? { repos: destination.repos } : {}),
          ...(destination.playbookId
            ? { playbook_id: destination.playbookId }
            : {}),
        }),
      };
    case 'slack':
      return {
        url: destination.url,
        headers: json,
        body: JSON.stringify({
          text: `*${payload.issue.title}*\n${payload.issue.service} · ${payload.issue.count} occurrences · ${payload.trigger}${payload.url ? `\n${payload.url}` : ''}`,
        }),
      };
    case 'pagerduty':
      return {
        url: 'https://events.pagerduty.com/v2/enqueue',
        headers: json,
        body: JSON.stringify({
          routing_key: destination.routingKey,
          event_action: 'trigger',
          // One incident per issue: repeats update it instead of paging again.
          dedup_key: `autotel-issue-${payload.issue.fingerprint}`,
          payload: {
            summary: `${payload.issue.service}: ${payload.issue.title}`.slice(
              0,
              1024,
            ),
            source: payload.issue.service,
            severity: 'error',
            custom_details: {
              count: payload.issue.count,
              culprit: payload.issue.culprit,
              trigger: payload.trigger,
              url: payload.url,
            },
          },
        }),
      };
  }
}

export interface DeliveryResult {
  ok: boolean;
  attempts: number;
  status?: number;
  error?: string;
}

/**
 * POST with up to three attempts (Cloudflare's hand-off policy). A 4xx other
 * than 408/429 is the destination refusing the request, so it is not retried.
 */
export async function deliver(
  destination: Destination,
  payload: IssuePayload,
  options: {
    fetch?: typeof fetch;
    attempts?: number;
    backoffMs?: number;
  } = {},
): Promise<DeliveryResult> {
  const doFetch = options.fetch ?? fetch;
  const attempts = options.attempts ?? 3;
  const backoffMs = options.backoffMs ?? 500;
  let last: DeliveryResult = { ok: false, attempts: 0 };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const request = await buildRequest(destination, payload);
      const response = await doFetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
      });
      if (response.ok)
        return { ok: true, attempts: attempt, status: response.status };
      last = {
        ok: false,
        attempts: attempt,
        status: response.status,
        error: `HTTP ${response.status}`,
      };
      const retryable =
        response.status >= 500 ||
        response.status === 408 ||
        response.status === 429;
      if (!retryable) return last;
    } catch (error) {
      last = {
        ok: false,
        attempts: attempt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, backoffMs * attempt));
    }
  }
  return last;
}
