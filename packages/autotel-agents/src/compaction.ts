/**
 * Context compaction — the moment a coding agent forgets.
 *
 * When a session outgrows its context window the agent replaces the
 * conversation with a summary and continues. Nothing announces it: Claude Code
 * emits no compaction event, and the timeline either side of the boundary looks
 * identical. But everything before that point has left the agent's head, so any
 * later answer that leans on it is reconstruction, not recall.
 *
 * The boundary is visible in token counts the agent already reports. A prompt
 * is `input + cache_read + cache_creation` tokens, and it grows monotonically
 * while a conversation accumulates. Compaction is the discontinuity: the cached
 * prefix is abandoned, a summary is written, and the total drops hard.
 *
 * Two things keep the inference honest. Requests are grouped by
 * {@link AgentEvent.contextLineageId} — a sub-agent runs its own conversation,
 * and comparing its prompt size against the parent's reads one as a compaction
 * of the other. And requests whose token counts were *estimated* are ignored
 * outright: a compaction inferred from a guessed prompt size is a guess about a
 * guess.
 *
 * **This is inference, not observation.** A drop is evidence of a reset, never
 * proof of one, which is why every {@link ContextReset} carries a confidence and
 * why nothing here claims to know what the summary contained.
 */

import type { AgentEvent, AgentSessionRollup } from './types';

/**
 * A point where the agent's context was replaced. Named for what was observed —
 * the context reset — rather than for the cause, which is inferred.
 */
export interface ContextReset {
  /** The `api_request` the drop was detected at. */
  atEventId: string;
  timestamp: number;
  /** Conversation the reset happened in, when the agent distinguishes them. */
  lineageId?: string;
  /** High-water context before the reset. */
  contextBefore: number;
  /** Context of the request that followed it. */
  contextAfter: number;
  droppedTokens: number;
  /**
   * `likely` when the request that followed wrote a substantial new cache —
   * a summary being laid down. `possible` when the context merely shrank, which
   * a long tool result or an unrelated request can also do.
   */
  confidence: 'likely' | 'possible';
}

/**
 * Prompt size in tokens. Cached and fresh tokens are both context: a 100k
 * conversation whose prefix is fully cached reports `input_tokens: 2`, so
 * reading input alone makes every long session look empty.
 */
export function contextTokens(
  event: Pick<
    AgentEvent,
    'inputTokens' | 'cacheReadTokens' | 'cacheCreationTokens'
  >,
): number {
  return (
    (event.inputTokens ?? 0) +
    (event.cacheReadTokens ?? 0) +
    (event.cacheCreationTokens ?? 0)
  );
}

/**
 * Context below this is too small to have been compacted — a short session, or
 * a one-shot request that shares the session id.
 *
 * Provisional: tuned against synthetic timelines, not yet against a recorded
 * session that actually compacted.
 */
const MIN_CONTEXT_TO_COMPACT = 20_000;

/**
 * A reset keeps at most this fraction of the context it replaced.
 *
 * Half, not more: a conversation that still holds 60% of its prompt is
 * shrinking, not replaced, and treating that as a compaction reports losses
 * that did not happen.
 */
const RESET_RATIO = 0.5;

/** New cache at or above this reads as a summary being written. */
const SUMMARY_CACHE_TOKENS = 4000;

/** Bucket for agents that do not distinguish conversations within a session. */
const DEFAULT_LINEAGE = 'default';

/**
 * Fold one `api_request` into the session's context state.
 *
 * Incremental by necessity — the timeline is ring-buffered, so a pass over it
 * would lose every reset older than the window.
 *
 * A drop is only a reset if the context never comes back. A sub-agent runs on
 * its own fresh context, so its requests are small and interleaved among the
 * parent's large ones; pairwise comparison calls every one of those a
 * compaction. So a drop is recorded immediately and *withdrawn* when a later
 * request climbs back over the pre-drop high-water: that was an excursion, and
 * the parent never lost anything.
 */
export function foldContextReset(
  rollup: AgentSessionRollup,
  event: AgentEvent,
): void {
  // An estimated prompt size cannot support a claim about the real one, and it
  // must not seed the baseline either: a wrong high-water makes every later
  // comparison wrong too.
  if (event.tokenSource === 'estimated') return;

  const context = contextTokens(event);
  if (context === 0) return;

  const lineage = event.contextLineageId ?? DEFAULT_LINEAGE;
  const highWater = rollup.contextState[lineage] ?? 0;

  const lastReset = rollup.compactions.findLast(
    (reset) => (reset.lineageId ?? DEFAULT_LINEAGE) === lineage,
  );
  if (lastReset && context >= lastReset.contextBefore) {
    // Back above where it dropped from — but how it got there decides what it
    // means. Regrowth after a real compaction is gradual, so by the time the
    // context crosses the old high-water it has already climbed most of the way
    // there. A sub-agent excursion never climbs at all: the parent's context
    // reappears in one step from a context still the size of the summary. Only
    // that second shape withdraws the reset.
    const recovered = highWater >= lastReset.contextBefore * RESET_RATIO;
    if (!recovered) {
      rollup.compactions = rollup.compactions.filter((r) => r !== lastReset);
      setHighWater(rollup, lineage, context);
      return;
    }
  }

  if (
    highWater >= MIN_CONTEXT_TO_COMPACT &&
    context <= highWater * RESET_RATIO
  ) {
    rollup.compactions.push({
      atEventId: event.id,
      timestamp: event.timestamp,
      ...(event.contextLineageId !== undefined && {
        lineageId: event.contextLineageId,
      }),
      contextBefore: highWater,
      contextAfter: context,
      droppedTokens: highWater - context,
      confidence:
        (event.cacheCreationTokens ?? 0) >= SUMMARY_CACHE_TOKENS
          ? 'likely'
          : 'possible',
    });
    // The summary is the new baseline; the old high-water is gone with it.
    setHighWater(rollup, lineage, context);
    return;
  }

  setHighWater(rollup, lineage, Math.max(highWater, context));
}

/**
 * Record a lineage's high-water and republish the session-wide figure, which is
 * the largest across lineages — the headline "how big did this session get".
 */
function setHighWater(
  rollup: AgentSessionRollup,
  lineage: string,
  tokens: number,
): void {
  rollup.contextState[lineage] = tokens;
  rollup.contextHighWaterTokens = Math.max(
    ...Object.values(rollup.contextState),
  );
}

/**
 * Whether the agent got worse after a context reset.
 *
 * Detecting the boundary is the easy half. What costs the user is what happens
 * next: with the record of its own work gone, the agent re-reads files it had
 * already read and re-explores ground it had already covered. That shows up as
 * the read share of its tool calls jumping after the boundary.
 *
 * Computed on demand over the retained timeline rather than folded in, because
 * it needs both sides of the boundary at once. The timeline is ring-buffered,
 * so on an old reset one side may have rolled away — {@link regressed} is then
 * `undefined`, which is the honest answer rather than a verdict from half the
 * evidence.
 */
export interface PostCompactionRegression {
  /** Share of tool calls that were reads before the reset, 0–1. */
  readShareBefore: number;
  /** Share of tool calls that were reads after it. */
  readShareAfter: number;
  callsBefore: number;
  callsAfter: number;
  /** `undefined` when the timeline no longer holds enough to compare. */
  regressed?: boolean;
  reason: string;
}

/** Re-exploration reads as a read share this much higher than before. */
const REGRESSION_MARGIN = 0.2;

/**
 * Tools that only look at things. The `file` category is not a substitute:
 * Read, Edit and Write all sit in it, so counting the category reports a burst
 * of editing — the agent doing the work — as re-exploration.
 */
const READ_TOOLS: ReadonlySet<string> = new Set([
  'read',
  'grep',
  'glob',
  'search',
  'notebookread',
  'webfetch',
  'websearch',
  'ls',
]);

function isRead(event: AgentEvent): boolean {
  const name = event.tool?.name?.toLowerCase();
  if (name === undefined) return false;
  return READ_TOOLS.has(name) || event.tool?.category === 'search';
}

function readShare(events: AgentEvent[]): number {
  const reads = events.filter((event) => isRead(event)).length;
  return events.length === 0 ? 0 : reads / events.length;
}

export function postCompactionRegression(
  timeline: readonly AgentEvent[],
  reset: Pick<ContextReset, 'timestamp'>,
): PostCompactionRegression {
  const calls = timeline.filter((e) => e.tool !== undefined);
  const before = calls.filter((e) => e.timestamp < reset.timestamp);
  const after = calls.filter((e) => e.timestamp >= reset.timestamp);

  const readShareBefore = readShare(before);
  const readShareAfter = readShare(after);
  const base = {
    readShareBefore,
    readShareAfter,
    callsBefore: before.length,
    callsAfter: after.length,
  };

  if (before.length === 0 || after.length === 0) {
    return {
      ...base,
      reason:
        'no calls retained on one side of the reset — the timeline window has rolled past it',
    };
  }

  const regressed = readShareAfter - readShareBefore >= REGRESSION_MARGIN;
  return {
    ...base,
    regressed,
    reason: regressed
      ? 'read share rose after the reset — the agent is re-reading what it had already seen'
      : 'read share held steady across the reset',
  };
}
