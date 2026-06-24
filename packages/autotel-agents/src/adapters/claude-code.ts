import { createPrefixAdapter } from './prefix-adapter';

/**
 * Claude Code: metrics/events prefixed `claude_code.*`, emitted under the
 * `com.anthropic.claude_code` instrumentation scope.
 * Contract: https://code.claude.com/docs/en/monitoring-usage
 */
export const claudeCodeAdapter = createPrefixAdapter({
  kind: 'claude-code',
  prefix: 'claude_code.',
  scopeHint: 'claude_code',
  serviceHint: 'claude-code',
});
