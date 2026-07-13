import { createPrefixAdapter, HANDLED_EVENT_NAMES } from './prefix-adapter';

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

/**
 * Event-name contract for Claude Code, used by the drift guard (a recorded
 * fixture asserts every emitted `event.name` is either handled or knowingly
 * ignored). When a new Claude Code version emits an unlisted event, that test
 * fails — the signal to decide "model it or ignore it" instead of silently
 * dropping it. `handled` mirrors the adapter's `EVENT_SUFFIXES`; `ignored` is
 * the set we deliberately skip (raw bodies, plaintext, setup noise).
 */
export const CLAUDE_CODE_EVENT_CONTRACT = {
  handled: HANDLED_EVENT_NAMES,
  ignored: [
    'api_request_body', // raw request JSON — captured for logs, not modeled
    'api_response_body', // raw response JSON
    'assistant_response', // plaintext response — privacy-gated, not a rollup fact
    'hook_registered', // startup registration noise
    'hook_execution_start', // paired with hook_execution_complete (which we model)
  ] as readonly string[],
} as const;

/** Every event.name Claude Code is known to emit (handled ∪ ignored). */
export const CLAUDE_CODE_KNOWN_EVENT_NAMES: ReadonlySet<string> = new Set([
  ...CLAUDE_CODE_EVENT_CONTRACT.handled,
  ...CLAUDE_CODE_EVENT_CONTRACT.ignored,
]);
