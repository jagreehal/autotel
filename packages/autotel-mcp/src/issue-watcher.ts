/**
 * Issue automations for backends without stored issue state: poll, and send
 * an issue with its full context when it crosses an occurrence threshold or
 * comes back after a quiet period. Lives outside the MCP tools, which stay
 * read-only. (autotel-devtools runs automations itself, persisted, with run
 * history; this is the same idea for any backend.)
 *
 * Environment only, since destinations carry credentials:
 *   AUTOTEL_ISSUES_DESTINATION     JSON destination, any type the shared core
 *                                  supports: webhook, claude-code, cursor,
 *                                  devin, slack, pagerduty
 *   AUTOTEL_ISSUES_WEBHOOK         shorthand for a webhook destination URL
 *   AUTOTEL_ISSUES_WEBHOOK_SECRET  HMAC-SHA256 signing secret for it
 *   AUTOTEL_ISSUES_THRESHOLD       occurrences before first send (default 5)
 *   AUTOTEL_ISSUES_QUIET_MINUTES   silence that makes a return a regression (60)
 *   AUTOTEL_ISSUES_INTERVAL_MS     poll interval (default 60000)
 */

import {
  deliver,
  type Destination,
  type Issue,
  type SendTrigger,
} from 'autotel-devtools/issues';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { TelemetryBackend } from './backends/telemetry';
import { issueContext, loadIssues } from './modules/issues';

interface Seen {
  lastSeen: number;
  count: number;
  /** A send succeeded for this issue at least once. */
  notified: boolean;
  /** Due but not delivered yet: retried every poll until a send succeeds. */
  pending?: SendTrigger;
}

/**
 * Which issues to send this poll. Pure, so the rules are testable. Polling
 * sees counts jump, so a threshold is "reached since the last poll", not the
 * single-step crossing the ingest-time engine checks. A recurrence is a new
 * occurrence on an issue that, as of the previous poll, had been silent for
 * `quietMs`.
 */
export function pickNotifications(
  issues: Issue[],
  state: Map<string, Seen>,
  options: { threshold: number; quietMs: number; previousPollUnixMs: number },
): Array<{ issue: Issue; trigger: SendTrigger }> {
  const out: Array<{ issue: Issue; trigger: SendTrigger }> = [];
  for (const issue of issues) {
    if (issue.status === 'ignored') continue;
    const seen = state.get(issue.fingerprint);
    let due: SendTrigger | undefined = seen?.pending;
    if (!due && !seen?.notified && issue.count >= options.threshold) {
      due = 'threshold';
    } else if (
      !due &&
      seen?.notified &&
      issue.lastSeen > seen.lastSeen &&
      options.previousPollUnixMs - seen.lastSeen >= options.quietMs
    ) {
      due = 'recurrence';
    }
    if (due) out.push({ issue, trigger: due });
    // Sent-ness is recorded by `markSent`, after delivery: picking an issue
    // only makes it pending, so a failure anywhere before the send retries.
    state.set(issue.fingerprint, {
      lastSeen: issue.lastSeen,
      count: issue.count,
      notified: seen?.notified ?? false,
      ...(due ? { pending: due } : {}),
    });
  }
  return out;
}

/** Record a successful send: the issue is notified and nothing is pending. */
export function markSent(state: Map<string, Seen>, fingerprint: string): void {
  const seen = state.get(fingerprint);
  if (seen)
    state.set(fingerprint, { ...seen, notified: true, pending: undefined });
}

export function destinationFromEnv(
  env: NodeJS.ProcessEnv,
): Destination | undefined {
  if (env.AUTOTEL_ISSUES_DESTINATION) {
    const parsed = JSON.parse(
      env.AUTOTEL_ISSUES_DESTINATION,
    ) as Partial<Destination> & Pick<Destination, 'type'>;
    return {
      ...parsed,
      id: parsed.id ?? 'env',
      name: parsed.name ?? parsed.type,
    } as Destination;
  }
  if (env.AUTOTEL_ISSUES_WEBHOOK) {
    return {
      type: 'webhook',
      id: 'env',
      name: 'webhook',
      url: env.AUTOTEL_ISSUES_WEBHOOK,
      ...(env.AUTOTEL_ISSUES_WEBHOOK_SECRET
        ? { secret: env.AUTOTEL_ISSUES_WEBHOOK_SECRET }
        : {}),
    };
  }
  return undefined;
}

export interface WatcherRun {
  fingerprint: string;
  title: string;
  trigger: SendTrigger;
  destination: string;
  ok: boolean;
  attempts: number;
  error?: string;
  at: number;
}

interface WatcherSnapshot {
  previousPollUnixMs: number;
  seen: Record<string, Seen>;
  /** Newest last, capped. */
  runs: WatcherRun[];
}

const MAX_RUNS = 200;

/**
 * Where the watcher remembers what it already sent. Without a file a restart
 * would send every open issue again; with one, it picks up where it stopped.
 */
function loadSnapshot(path: string | undefined, now: number): WatcherSnapshot {
  if (path && existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as WatcherSnapshot;
    } catch {
      console.error(`[autotel-mcp] ignoring unreadable issue state at ${path}`);
    }
  }
  return { previousPollUnixMs: now, seen: {}, runs: [] };
}

function saveSnapshot(path: string | undefined, snapshot: WatcherSnapshot) {
  if (!path) return;
  // Write-then-rename, so a crash mid-write never leaves half a file.
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(snapshot));
  renameSync(temp, path);
}

export interface IssueWatcherOptions {
  backend: TelemetryBackend;
  destination: Destination;
  threshold: number;
  quietMinutes: number;
  /** JSON file for sent-state and run history. Omit to keep it in memory. */
  statePath?: string;
  /** Injected in tests. */
  deliver?: typeof deliver;
}

export function createIssueWatcher(options: IssueWatcherOptions) {
  const send = options.deliver ?? deliver;
  const snapshot = loadSnapshot(options.statePath, Date.now());
  const state = new Map(Object.entries(snapshot.seen));

  return {
    /** Recent sends, newest first. */
    runs: (): WatcherRun[] => [...snapshot.runs].reverse(),

    async poll(now = Date.now()): Promise<WatcherRun[]> {
      // Look back far enough to see the quiet gap that defines a regression.
      const { issues } = await loadIssues(options.backend, {
        lookbackMinutes: Math.max(60, options.quietMinutes * 2),
        quietMinutes: options.quietMinutes,
        nowUnixMs: now,
      });
      const due = pickNotifications(issues, state, {
        threshold: options.threshold,
        quietMs: options.quietMinutes * 60_000,
        previousPollUnixMs: snapshot.previousPollUnixMs,
      });
      snapshot.previousPollUnixMs = now;
      const runs: WatcherRun[] = [];
      for (const { issue, trigger } of due) {
        // One issue's failure (context lookup or delivery) leaves it pending
        // for the next poll and does not stop the others.
        let outcome: Awaited<ReturnType<typeof deliver>>;
        try {
          const context = await issueContext(options.backend, issue);
          outcome = await send(options.destination, {
            trigger,
            issue,
            trace: context.latestOccurrence?.trace,
            logs: context.surroundingLogs.map((log) => ({
              timestamp: log.timestampUnixMs,
              severity: log.severityText,
              body: log.body,
            })),
          });
        } catch (error) {
          outcome = {
            ok: false,
            attempts: 0,
            error: error instanceof Error ? error.message : String(error),
          };
        }
        if (outcome.ok) markSent(state, issue.fingerprint);
        runs.push({
          fingerprint: issue.fingerprint,
          title: issue.title,
          trigger,
          destination: options.destination.type,
          ok: outcome.ok,
          attempts: outcome.attempts,
          ...(outcome.error ? { error: outcome.error } : {}),
          at: Date.now(),
        });
        if (!outcome.ok) {
          console.error(
            `[autotel-mcp] issue ${issue.fingerprint} → ${options.destination.type}: ${outcome.error ?? 'failed'}; retrying next poll`,
          );
        }
      }
      snapshot.seen = Object.fromEntries(state);
      snapshot.runs = [...snapshot.runs, ...runs].slice(-MAX_RUNS);
      saveSnapshot(options.statePath, snapshot);
      return runs;
    },
  };
}

/**
 * Start polling from the environment. State goes to
 * `AUTOTEL_ISSUES_STATE`, or beside the `--persist` database when there is
 * one, so automations survive restarts the way the telemetry does.
 */
export function startIssueWatcher(
  backend: TelemetryBackend,
  env: NodeJS.ProcessEnv = process.env,
  persist?: string,
): (() => void) | undefined {
  const destination = destinationFromEnv(env);
  if (!destination) return undefined;
  const statePath =
    env.AUTOTEL_ISSUES_STATE ??
    (persist ? `${persist}.issues.json` : undefined);
  const watcher = createIssueWatcher({
    backend,
    destination,
    threshold: Number(env.AUTOTEL_ISSUES_THRESHOLD ?? 5),
    quietMinutes: Number(env.AUTOTEL_ISSUES_QUIET_MINUTES ?? 60),
    statePath,
  });
  const timer = setInterval(
    () => {
      watcher
        .poll()
        .catch((error: unknown) =>
          console.error('[autotel-mcp] issue watcher:', error),
        );
    },
    Number(env.AUTOTEL_ISSUES_INTERVAL_MS ?? 60_000),
  );
  timer.unref();
  console.error(
    `[autotel-mcp] issue automations on: ${destination.type}` +
      (statePath ? `, state in ${statePath}` : ', state in memory'),
  );
  return () => clearInterval(timer);
}
