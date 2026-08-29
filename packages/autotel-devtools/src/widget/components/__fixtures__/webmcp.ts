/**
 * WebMCP inventory fixtures, shared by the view's story and its test so the
 * catalogue and the assertions describe the same data.
 */

import type { WebMcpInventory, WebMcpTool } from '../../types';

export function makeTool(over: Partial<WebMcpTool> = {}): WebMcpTool {
  return {
    name: 'checkout',
    installationId: 'inst-1',
    service: 'shop',
    sessionId: 'sess-1',
    observedAtRegistration: true,
    offered: true,
    firstSeen: 1_700_000_000_000,
    lastSeen: 1_700_000_000_500,
    descriptionLength: 42,
    hasInputSchema: true,
    annotationsSent: [],
    annotationsDropped: [],
    calls: 3,
    errors: 0,
    envelopeCalls: 0,
    envelopeBytes: 0,
    substitutedCalls: 0,
    resultBytes: 39,
    medianResultBytes: 13,
    recentCalls: [],
    ...over,
  };
}

export function makeInventory(
  tools: WebMcpTool[],
  summary: Partial<WebMcpInventory['summary']> = {},
): WebMcpInventory {
  return {
    tools,
    summary: {
      installations: 1,
      emptyInstallations: 0,
      toolsOffered: tools.filter((t) => t.offered).length,
      toolsWithdrawn: tools.filter((t) => !t.offered).length,
      calls: tools.reduce((n, t) => n + t.calls, 0),
      errors: tools.reduce((n, t) => n + t.errors, 0),
      resultBytes: tools.reduce((n, t) => n + t.resultBytes, 0),
      envelopeBytes: tools.reduce((n, t) => n + t.envelopeBytes, 0),
      toolsWithDroppedAnnotations: tools.filter(
        (t) => t.annotationsDropped.length > 0,
      ).length,
      toolsWithoutInputSchema: tools.filter(
        (t) => t.observedAtRegistration && t.hasInputSchema === false,
      ).length,
      ...summary,
    },
  };
}
