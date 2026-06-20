import { describe, expect, it, vi } from 'vitest';
import { createMcpSecurityEventBridge } from './mcp-bridge.js';

const securityEvent = vi.fn();

vi.mock('./security.js', () => ({
  securityEvent: (...args: unknown[]) => securityEvent(...args),
}));

describe('createMcpSecurityEventBridge', () => {
  it('maps MCP metadata to securityEvent with tool target', () => {
    const bridge = createMcpSecurityEventBridge();
    bridge({
      name: 'llm.manifest.suspicious',
      category: 'llm',
      outcome: 'denied',
      severity: 'warning',
      toolName: 'evil_tool',
      verdict: 'suspicious',
      reason: 'instruction_override',
    });

    expect(securityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'llm.manifest.suspicious',
        category: 'llm',
        outcome: 'denied',
        targetType: 'tool',
        targetId: 'evil_tool',
        verdict: 'suspicious',
        reason: 'instruction_override',
      }),
      {},
    );
  });
});
