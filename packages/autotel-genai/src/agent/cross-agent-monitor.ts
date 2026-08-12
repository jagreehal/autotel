import { securityEvent } from 'autotel-audit';
import {
  crossAgentDetectionsToSecurityEvents,
  detectCrossAgentPattern,
  type CrossAgentEvent,
  type CrossAgentDetection,
  type DetectCrossAgentPatternOptions,
} from './cross-agent-detect.js';
import type { AgentContext } from './context.js';

export interface CrossAgentMonitorOptions extends DetectCrossAgentPatternOptions {
  ctx?: AgentContext;
  /** Called when a new detection appears (deduped by resource key). */
  onDetection?: (detection: CrossAgentDetection) => void;
  onMissingContext?: 'warn' | 'skip' | 'throw';
}

/**
 * Live monitor for shared-channel abuse (Artifactory message-board pattern).
 * Feed tool/memory events as they occur; emits `agent.shared_channel.detected`.
 */
export class CrossAgentMonitor {
  private readonly events: CrossAgentEvent[] = [];
  private readonly seen = new Set<string>();
  private readonly options: CrossAgentMonitorOptions;

  constructor(options: CrossAgentMonitorOptions = {}) {
    this.options = options;
  }

  record(event: CrossAgentEvent): CrossAgentDetection[] {
    this.events.push({
      ...event,
      timestamp: event.timestamp ?? Date.now(),
    });
    const detections = detectCrossAgentPattern(this.events, this.options);
    const fresh: CrossAgentDetection[] = [];

    for (const detection of detections) {
      const key = detection.resource;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      fresh.push(detection);
      this.options.onDetection?.(detection);
      for (const payload of crossAgentDetectionsToSecurityEvents([detection])) {
        securityEvent(payload, {
          ctx: this.options.ctx,
          onMissingContext: this.options.onMissingContext ?? 'warn',
        });
      }
    }

    return fresh;
  }

  reset(): void {
    this.events.length = 0;
    this.seen.clear();
  }
}
