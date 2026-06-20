import type { AuditContext } from './context.js';
import {
  securityEvent,
  type SecurityEventMetadata,
  type SecurityEventOptions,
} from './security.js';

/**
 * Metadata emitted when MCP protocol-boundary signals are bridged to the
 * unified `security.*` schema. Used by `autotel-mcp-instrumentation` when
 * `bridgeSecurityEvents` is enabled.
 */
export interface McpBridgedSecurityEvent {
  name: SecurityEventMetadata['name'];
  category: 'llm';
  outcome: SecurityEventMetadata['outcome'];
  severity?: SecurityEventMetadata['severity'];
  reason?: string;
  toolName?: string;
  verdict?: string;
  source?: string;
  [key: string]: unknown;
}

export interface McpSecurityEventBridgeOptions extends SecurityEventOptions {
  /** Optional fixed audit context for bridged events. */
  ctx?: AuditContext;
}

/**
 * Create a bridge callback for MCP security observability → `securityEvent()`.
 *
 * @example
 * ```typescript
 * import { createMcpSecurityEventBridge } from 'autotel-audit';
 * import { instrumentMcpClient } from 'autotel-mcp-instrumentation/client';
 *
 * instrumentMcpClient(client, {
 *   securityClassifier: heuristicInjectionClassifier(),
 *   bridgeSecurityEvents: true,
 *   securityEventBridge: createMcpSecurityEventBridge(),
 * });
 * ```
 */
export function createMcpSecurityEventBridge(
  options: McpSecurityEventBridgeOptions = {},
): (metadata: McpBridgedSecurityEvent) => void {
  return (metadata) => {
    const { toolName, verdict, source, ...rest } = metadata;
    securityEvent(
      {
        ...rest,
        category: 'llm',
        ...(toolName !== undefined && { targetType: 'tool', targetId: toolName }),
        ...(verdict !== undefined && { verdict }),
        ...(source !== undefined && { source }),
      },
      options,
    );
  };
}
