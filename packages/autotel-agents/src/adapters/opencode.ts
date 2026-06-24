import { createPrefixAdapter } from './prefix-adapter';

/**
 * opencode: the opencode-plugin-otel project mirrors Claude Code's exact
 * instrument and event names under an `opencode.*` prefix and the `com.opencode`
 * scope. Same shape → same factory.
 */
export const opencodeAdapter = createPrefixAdapter({
  kind: 'opencode',
  prefix: 'opencode.',
  scopeHint: 'opencode',
  serviceHint: 'opencode',
});
