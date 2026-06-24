import { str } from './attrs';
import type { Attributes } from './types';
import type { SessionIdentity } from './adapters/types';

export function mergeAttrs(...sources: Attributes[]): Attributes {
  return Object.assign({}, ...sources);
}

/** Pull the common identity attributes shared by every signal in a session. */
export function readIdentity(attrs: Attributes): SessionIdentity {
  return {
    user: str(attrs, 'user.id', 'user.account_uuid', 'user.email'),
    organization: str(attrs, 'organization.id'),
    terminal: str(attrs, 'terminal.type'),
    appVersion: str(attrs, 'app.version'),
    model: str(attrs, 'model'),
  };
}
