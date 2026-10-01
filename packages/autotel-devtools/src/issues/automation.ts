// When an issue should be sent somewhere. Pure: the caller supplies the
// issue's state before and after one new occurrence, and gets back which
// automations fire. Semantics follow Cloudflare Workers Issues automations.

export type AutomationTrigger =
  /** Once, when the issue's occurrence count reaches `count`. */
  | { type: 'threshold'; count: number }
  /** When an issue returns after `inactiveMs` with no newer occurrence. */
  | { type: 'recurrence'; inactiveMs: number };

export interface Automation {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  destinationId: string;
  enabled: boolean;
  /** Only issues from these services; empty or absent means all. */
  services?: string[];
}

export interface OccurrenceStep {
  service: string;
  status: 'active' | 'resolved' | 'ignored';
  /** Count before this occurrence. */
  previousCount: number;
  /** Timestamp of the latest earlier occurrence, if any. */
  previousLastSeen?: number;
  /** Timestamp of this occurrence. */
  timestamp: number;
}

export function firesOn(automation: Automation, step: OccurrenceStep): boolean {
  if (!automation.enabled || step.status === 'ignored') return false;
  if (
    automation.services &&
    automation.services.length > 0 &&
    !automation.services.includes(step.service)
  ) {
    return false;
  }
  const { trigger } = automation;
  if (trigger.type === 'threshold') {
    // Crossing, not "at or above": a threshold automation runs once per issue.
    return (
      step.previousCount < trigger.count &&
      step.previousCount + 1 >= trigger.count
    );
  }
  // A recurrence needs at least one earlier occurrence to recur from.
  return (
    step.previousLastSeen !== undefined &&
    step.timestamp - step.previousLastSeen >= trigger.inactiveMs
  );
}
