import { describe, expect, it, vi } from 'vitest';
import { CrossAgentMonitor } from './cross-agent-monitor.js';

vi.mock('autotel-audit', () => ({
  securityEvent: vi.fn(),
}));

describe('CrossAgentMonitor', () => {
  it('emits once per unique shared resource', () => {
    const onDetection = vi.fn();
    const monitor = new CrossAgentMonitor({ onDetection, minAgents: 2 });

    monitor.record({
      agentId: 'a',
      resource: 'artifactory:/notes',
      timestamp: 1,
    });
    expect(onDetection).not.toHaveBeenCalled();

    monitor.record({
      agentId: 'b',
      resource: 'artifactory:/notes',
      timestamp: 2,
    });
    expect(onDetection).toHaveBeenCalledTimes(1);

    monitor.record({
      agentId: 'c',
      resource: 'artifactory:/notes',
      timestamp: 3,
    });
    expect(onDetection).toHaveBeenCalledTimes(1);
  });
});
