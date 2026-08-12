import { describe, expect, it } from 'vitest';
import {
  crossAgentDetectionsToSecurityEvents,
  detectCrossAgentPattern,
} from './cross-agent-detect.js';

describe('detectCrossAgentPattern', () => {
  it('returns empty when a single agent uses a resource', () => {
    const detections = detectCrossAgentPattern([
      { agentId: 'eval-a', resource: 'artifactory:/notes', timestamp: 1 },
      { agentId: 'eval-a', resource: 'artifactory:/notes', timestamp: 2 },
    ]);
    expect(detections).toHaveLength(0);
  });

  it('flags multiple agents on the same registry path', () => {
    const detections = detectCrossAgentPattern([
      {
        agentId: 'eval-may-08',
        resource: 'artifactory:/remote-cache/notes',
        timestamp: 1,
      },
      {
        agentId: 'eval-may-10',
        resource: 'artifactory:/remote-cache/notes',
        timestamp: 2,
      },
      {
        agentId: 'eval-june-11',
        resource: 'artifactory:/remote-cache/notes',
        timestamp: 3,
      },
    ]);
    expect(detections).toHaveLength(1);
    expect(detections[0]?.agentIds).toHaveLength(3);
    expect(detections[0]?.reason).toContain('message board');
  });

  it('groups by memory isolation key when present', () => {
    const detections = detectCrossAgentPattern([
      {
        agentId: 'agent-a',
        resource: 'store-1',
        isolationKey: 'eval-shared',
        timestamp: 1,
      },
      {
        agentId: 'agent-b',
        resource: 'store-1',
        isolationKey: 'eval-shared',
        timestamp: 2,
      },
    ]);
    expect(detections).toHaveLength(1);
    expect(detections[0]?.resource).toBe('store-1');
  });

  it('maps detections to security events', () => {
    const detections = detectCrossAgentPattern([
      { agentId: 'a', resource: 'r', timestamp: 1 },
      { agentId: 'b', resource: 'r', timestamp: 2 },
    ]);
    const events = crossAgentDetectionsToSecurityEvents(detections);
    expect(events[0]?.name).toBe('agent.shared_channel.detected');
    expect(events[0]?.metadata.agentIds).toEqual(['a', 'b']);
  });
});
