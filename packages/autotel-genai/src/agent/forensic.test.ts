import { describe, expect, it } from 'vitest';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import {
  querySpansForEvalIncident,
  spansToCrossAgentEvents,
} from './forensic.js';
import { EVAL_IDENTITY_ATTR } from './eval-identity.js';

/** Minimal ReadableSpan stub — only the fields the forensic reader touches. */
function span(attributes: Record<string, string>, epochMs = 1_700_000_000_000) {
  return {
    name: 'tools/call artifactory_fetch',
    attributes,
    startTime: [Math.floor(epochMs / 1000), (epochMs % 1000) * 1e6],
  } as unknown as ReadableSpan;
}

describe('querySpansForEvalIncident', () => {
  it('returns empty summary for no spans', () => {
    const result = querySpansForEvalIncident([]);
    expect(result.summary[0]).toContain('Spans analyzed: 0');
  });

  it('reports two sandboxed eval runs reaching the same shared registry', () => {
    // Isolated sandboxes touching one shared registry path is the exact breach
    // this query exists to surface. Keying the group by the caller's sandbox
    // gives each run its own group, so the shared access is never detected.
    const spans = [
      span({
        [EVAL_IDENTITY_ATTR.runId]: 'run-a',
        [EVAL_IDENTITY_ATTR.sandboxId]: 'sandbox-a',
        'gen_ai.tool.name': 'artifactory_fetch',
      }),
      span({
        [EVAL_IDENTITY_ATTR.runId]: 'run-b',
        [EVAL_IDENTITY_ATTR.sandboxId]: 'sandbox-b',
        'gen_ai.tool.name': 'artifactory_fetch',
      }),
    ];

    const result = querySpansForEvalIncident(spans);

    expect(result.crossAgentEvents).toHaveLength(1);
    expect(result.crossAgentEvents[0].metadata.agentIds).toEqual(
      expect.arrayContaining(['run-a', 'run-b']),
    );
  });

  it('groups a registry resource by the registry path, not the caller', () => {
    // The resource identifies the shared thing. Folding the sandbox into it
    // makes two views of one registry look like two different registries.
    const events = spansToCrossAgentEvents([
      span({
        [EVAL_IDENTITY_ATTR.runId]: 'run-a',
        [EVAL_IDENTITY_ATTR.sandboxId]: 'sandbox-a',
        'gen_ai.tool.name': 'artifactory_fetch',
      }),
      span({
        [EVAL_IDENTITY_ATTR.runId]: 'run-b',
        [EVAL_IDENTITY_ATTR.sandboxId]: 'sandbox-b',
        'gen_ai.tool.name': 'artifactory_fetch',
      }),
    ]);

    expect(events[0].resource).toBe(events[1].resource);
    // `isolationKey` means "memory isolation key" and switches grouping to a
    // memory channel — a registry read is not a memory access.
    expect(events[0].isolationKey).toBeUndefined();
  });
});
