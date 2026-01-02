/**
 * Domain helpers for common attribute patterns
 * These bundle multiple attribute groups into semantic helpers
 */

import { attrs } from './builders';
import { safeSetAttributes } from './utils';

export function transaction(
  spanOrContext: import('../trace-context').TraceContext,
  config: {
    user?: import('./types').UserAttrs;
    session?: import('./types').SessionAttrs;
    method?: string;
    route?: string;
    statusCode?: number;
    clientIp?: string;
  },
  guardrails?: import('./validators').AttributePolicy,
): void {
  const userAttrs = attrs.user.data(config.user || {});
  const sessionAttrs = attrs.session.data(config.session || {});
  const httpAttrs = attrs.http.server({
    method: config.method,
    route: config.route,
    statusCode: config.statusCode,
  });
  const networkAttrs = attrs.network.peerAddress(config.clientIp || '');

  const merged = {
    ...userAttrs,
    ...sessionAttrs,
    ...httpAttrs,
    ...networkAttrs,
  };

  if (config.method && config.route && 'updateName' in spanOrContext) {
    spanOrContext.updateName(`HTTP ${config.method} ${config.route}`);
  }

  safeSetAttributes(spanOrContext, merged, guardrails);
}
