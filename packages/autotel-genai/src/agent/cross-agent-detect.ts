/**
 * Cross-agent pattern detection — flags when multiple agent identities touch the
 * same shared resource (registry path, memory isolation key) within a time window.
 *
 * Models the Artifactory "message board" from the OpenAI/HuggingFace incident,
 * where unrelated eval agents discovered and wrote to a shared package store.
 */

export interface CrossAgentEvent {
  /** Distinct agent identity (e.g. eval run id). */
  agentId: string;
  /** Shared resource touched — registry path, store id, isolation key, etc. */
  resource: string;
  /** Optional memory isolation key when the event is a memory access. */
  isolationKey?: string;
  /** Epoch ms; defaults to Date.now() when omitted. */
  timestamp?: number;
}

export interface CrossAgentDetection {
  resource: string;
  agentIds: string[];
  eventCount: number;
  reason: string;
}

export interface DetectCrossAgentPatternOptions {
  /** Minimum distinct agents on one resource to flag. Default 2. */
  minAgents?: number;
  /** Sliding window in ms. Default 86_400_000 (24h). 0 = no window. */
  windowMs?: number;
}

/**
 * Declared as a type alias, not an interface: `securityEvent()` takes a
 * `SecurityEventMetadata`, which carries an `[key: string]: unknown` index
 * signature. TypeScript gives type aliases an implicit index signature but
 * never gives one to an interface, so an interface here is unassignable no
 * matter how well the named fields line up.
 */
export type CrossAgentSecurityEvent = {
  name: 'agent.shared_channel.detected';
  /**
   * `autotel-audit`'s `SecurityEventCategory` has no `agent` member, and an
   * unsupported value fails to compile at the `securityEvent()` call. `llm` is
   * the category that covers this surface; the agent framing lives in the event
   * name and `targetType`.
   */
  category: 'llm';
  outcome: 'denied';
  /** `SecuritySeverity` is `info|warning|error|critical` — there is no `high`. */
  severity: 'error';
  reason: string;
  targetType: 'resource';
  targetId: string;
  metadata: {
    agentIds: string[];
    eventCount: number;
  };
};

function groupKey(event: CrossAgentEvent): string {
  return event.isolationKey
    ? `memory:${event.isolationKey}`
    : `resource:${event.resource}`;
}

/**
 * Detect shared-channel usage across agent identities. Pure function — safe to
 * run over exported span batches or audit logs in incident replay.
 */
export function detectCrossAgentPattern(
  events: CrossAgentEvent[],
  options: DetectCrossAgentPatternOptions = {},
): CrossAgentDetection[] {
  const { minAgents = 2, windowMs = 86_400_000 } = options;
  const grouped = new Map<
    string,
    { resource: string; events: CrossAgentEvent[] }
  >();

  for (const event of events) {
    const key = groupKey(event);
    const existing = grouped.get(key);
    if (existing) {
      existing.events.push(event);
    } else {
      grouped.set(key, { resource: event.resource, events: [event] });
    }
  }

  const detections: CrossAgentDetection[] = [];

  for (const { resource, events: groupEvents } of grouped.values()) {
    const sorted =
      windowMs > 0
        ? groupEvents.toSorted(
            (a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0),
          )
        : groupEvents;

    const agentIds = new Set<string>();
    for (const event of sorted) {
      const ts = event.timestamp ?? Date.now();
      if (windowMs > 0) {
        const windowStart = ts - windowMs;
        const inWindow = sorted.filter((e) => {
          const eTs = e.timestamp ?? Date.now();
          return eTs >= windowStart && eTs <= ts;
        });
        const windowAgents = new Set(inWindow.map((e) => e.agentId));
        if (windowAgents.size >= minAgents) {
          for (const id of windowAgents) agentIds.add(id);
        }
      } else {
        agentIds.add(event.agentId);
      }
    }

    if (agentIds.size >= minAgents) {
      detections.push({
        resource,
        agentIds: [...agentIds],
        eventCount: groupEvents.length,
        reason: `${agentIds.size} agents touched shared resource "${resource}" — possible message board`,
      });
    }
  }

  return detections;
}

/**
 * Map detections to autotel-audit `securityEvent` payloads for emission during IR.
 */
export function crossAgentDetectionsToSecurityEvents(
  detections: CrossAgentDetection[],
): CrossAgentSecurityEvent[] {
  return detections.map((detection) => ({
    name: 'agent.shared_channel.detected',
    category: 'llm',
    outcome: 'denied',
    severity: 'error',
    reason: detection.reason,
    targetType: 'resource',
    targetId: detection.resource,
    metadata: {
      agentIds: detection.agentIds,
      eventCount: detection.eventCount,
    },
  }));
}
