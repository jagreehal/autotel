// Issue state from the receiver: status, destinations, automations, runs.
//
// Configured once from `Widget.svelte` with the receiver's HTTP base, like the
// source loader: in embedded mode the page origin is the app's, not ours.
// Every read degrades to an empty answer; writes report failure as `null`.

import type { Automation, Destination, IssueStatus } from '../issues';

export interface IssueSummary {
  fingerprint: string;
  status: IssueStatus;
  count: number;
}

export interface IssueRunSummary {
  id: number;
  destinationId: string;
  trigger: string;
  status: 'pending' | 'succeeded' | 'failed';
  attempts: number;
  error?: string;
  createdAt: number;
}

let base: string | null = null;
let fetchImpl: typeof fetch = (...args) => fetch(...args);

export function configureIssuesClient(
  receiverBase: string | null,
  impl?: typeof fetch,
): void {
  base = receiverBase;
  if (impl) fetchImpl = impl;
}

async function call<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T | null> {
  if (base === null) return null;
  try {
    const res = await fetchImpl(`${base}${path}`, {
      method: init?.method ?? (init?.body === undefined ? 'GET' : 'POST'),
      headers: { 'content-type': 'application/json' },
      ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Status by fingerprint, for every issue the receiver knows (a week back). */
export async function fetchIssueStatuses(): Promise<Map<string, IssueSummary>> {
  const start = Date.now() - 7 * 86_400_000;
  const body = await call<{ issues: IssueSummary[] }>(
    `/api/issues?limit=500&start=${start}`,
  );
  return new Map(
    (body?.issues ?? []).map((issue) => [issue.fingerprint, issue]),
  );
}

export const setIssueStatus = (fingerprint: string, status: IssueStatus) =>
  call<{ status: IssueStatus }>(
    `/api/issues/${encodeURIComponent(fingerprint)}/status`,
    {
      body: { status },
    },
  );

export const sendIssue = (fingerprint: string, destinationId: string) =>
  call<{ run: IssueRunSummary | null }>(
    `/api/issues/${encodeURIComponent(fingerprint)}/send`,
    {
      body: { destinationId },
    },
  );

export const fetchIssueRuns = async (fingerprint: string) =>
  (
    await call<{ runs: IssueRunSummary[] }>(
      `/api/issue-runs?fingerprint=${encodeURIComponent(fingerprint)}`,
    )
  )?.runs ?? [];

export const fetchDestinations = async () =>
  (await call<{ destinations: Destination[] }>('/api/issue-destinations'))
    ?.destinations ?? [];

export const saveDestination = (
  destination: Partial<Destination> & { type: Destination['type'] },
) =>
  call<{ destination: Destination }>('/api/issue-destinations', {
    body: destination,
  });

export const deleteDestination = (id: string) =>
  call<{ id: string }>(`/api/issue-destinations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });

export const fetchAutomations = async () =>
  (await call<{ automations: Automation[] }>('/api/issue-automations'))
    ?.automations ?? [];

export const saveAutomation = (
  automation: Omit<Automation, 'id' | 'enabled'> & {
    id?: string;
    enabled?: boolean;
  },
) =>
  call<{ automation: Automation }>('/api/issue-automations', {
    body: automation,
  });

export const deleteAutomation = (id: string) =>
  call<{ id: string }>(`/api/issue-automations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
