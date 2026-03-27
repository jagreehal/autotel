/**
 * Redaction utility for structured log output
 *
 * Inspired by pino's redaction — zero-dependency, edge-compatible.
 * Supports deep paths, wildcards, and custom censor values.
 *
 * @example
 * ```typescript
 * const redactor = createRedactor({
 *   paths: ['password', 'user.email', 'headers.authorization'],
 * })
 * const safe = redactor({ password: 'secret', user: { email: 'a@b.com' } })
 * // { password: '[Redacted]', user: { email: '[Redacted]' } }
 * ```
 */

const DEFAULT_CENSOR = '[Redacted]';

/**
 * Validate and parse a dot/bracket path string into segments.
 *
 * Valid: "user.email", "users[*].name", "headers.*", "[0].secret"
 * Invalid: "user..email", "user[", "foo.]bar", ""
 */
function parsePath(path: string): string[] {
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error(
      `redact path must be a non-empty string, got: ${JSON.stringify(path)}`,
    );
  }

  // Reject obviously malformed paths
  if (path.includes('..')) {
    throw new Error(
      `redact path contains empty segment: ${JSON.stringify(path)}`,
    );
  }
  // Unmatched brackets: "[" with no "]" or vice versa
  const openBracket = path.indexOf('[');
  const closeBracket = path.indexOf(']');
  if (
    (openBracket !== -1 && closeBracket === -1) ||
    (closeBracket !== -1 && openBracket === -1)
  ) {
    throw new Error(
      `redact path has unclosed bracket: ${JSON.stringify(path)}`,
    );
  }
  if (openBracket !== -1 && closeBracket < openBracket) {
    throw new Error(
      `redact path has bracket close before open: ${JSON.stringify(path)}`,
    );
  }
  if (/\[\s*\]$/.test(path)) {
    throw new Error(
      `redact path has unclosed bracket: ${JSON.stringify(path)}`,
    );
  }
  if (/\][^.[\]]/.test(path) && !/\]\[/.test(path)) {
    // e.g. "foo.]bar" — closing bracket not followed by dot, bracket, or end
    const afterClose = path.match(/\]([^.[\]]+)/);
    if (afterClose) {
      throw new Error(
        `redact path has invalid characters after ']': ${JSON.stringify(path)}`,
      );
    }
  }

  const segments: string[] = [];
  const rx = /[^.[\]]+|\[(\d+|\*)\]/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  while ((match = rx.exec(path)) !== null) {
    segments.push(match[1] ?? match[0]);
    lastIndex = rx.lastIndex;
  }

  // If the regex didn't consume the whole string, something is malformed
  if (lastIndex < path.length) {
    throw new Error(
      `redact path has unexpected trailing content: ${JSON.stringify(path)}`,
    );
  }

  if (segments.length === 0) {
    throw new Error(
      `redact path produced no segments: ${JSON.stringify(path)}`,
    );
  }

  return segments;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deep clone plain objects and arrays only.
 * Non-plain objects (Date, Map, Set, class instances) are returned by reference.
 */
function deepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => deepClone(v)) as T;
  if (!isPlainObject(value)) return value;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    result[key] = deepClone((value as Record<string, unknown>)[key]);
  }
  return result as T;
}

/**
 * A node in the compiled path tree.
 *
 * Unlike a simple PathTree | null representation, a node can be both
 * a redact target AND a parent for deeper paths. This correctly handles
 * overlapping paths like ['user', 'user.email'].
 */
interface PathNode {
  redact?: boolean;
  children?: Record<string, PathNode>;
}

/**
 * Insert a parsed path into the tree.
 *
 * buildPathTree([['user'], ['user', 'email']]) produces:
 * { user: { redact: true, children: { email: { redact: true } } } }
 */
function buildPathTree(paths: string[][]): PathNode {
  const root: PathNode = {};
  for (const segments of paths) {
    let node = root;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const isLast = i === segments.length - 1;

      if (!node.children) node.children = {};
      if (!node.children[seg]) node.children[seg] = {};

      if (isLast) {
        node.children[seg].redact = true;
      }
      node = node.children[seg];
    }
  }
  return root;
}

/**
 * Walk a compiled path tree and redact matching values in `obj`.
 * Mutates `obj` in place (caller should clone before calling).
 */
function redactWithTree(
  obj: Record<string, any>,
  node: PathNode,
  censor: Censor,
  remove: boolean,
  path: string[] = [],
): void {
  if (!node.children) return;

  const applyCensor = (target: Record<string, any>, k: string, currentPath: string[]) => {
    if (remove) {
      delete target[k];
    } else {
      target[k] = typeof censor === 'function' ? censor(target[k], currentPath) : censor;
    }
  };

  for (const [key, childNode] of Object.entries(node.children)) {
    if (key === '*') {
      for (const k of Object.keys(obj)) {
        const wildcardPath = [...path, k];
        if (childNode.redact && !childNode.children) {
          applyCensor(obj, k, wildcardPath);
        } else if (childNode.redact && childNode.children) {
          const child = obj[k];
          if (
            child != null &&
            typeof child === 'object' &&
            !Array.isArray(child)
          ) {
            redactWithTree(child, childNode, censor, remove, wildcardPath);
          } else {
            applyCensor(obj, k, wildcardPath);
          }
        } else if (childNode.children) {
          const child = obj[k];
          if (child != null && typeof child === 'object') {
            redactWithTree(child, childNode, censor, remove, wildcardPath);
          }
        }
      }
      continue;
    }

    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;

    const val = obj[key];
    const currentPath = [...path, key];

    if (childNode.redact && !childNode.children) {
      applyCensor(obj, key, currentPath);
    } else if (childNode.redact && childNode.children) {
      if (val != null && typeof val === 'object') {
        redactWithTree(val, childNode, censor, remove, currentPath);
      }
    } else if (childNode.children && val != null && typeof val === 'object') {
      redactWithTree(val, childNode, censor, remove, currentPath);
    }
  }
}

export type Censor = string | ((value: unknown, path: string[]) => unknown);

export interface RedactorOptions {
  paths: string[];
  censor?: Censor;
  remove?: boolean;
}

/**
 * Preset name or explicit options
 */
export type RedactorConfig = RedactorOptions | RedactorPreset;

export type RedactorPreset = 'default' | 'strict' | 'pci-dss';

/**
 * Paths that match the main autotel package's `sensitiveKey` pattern:
 * `/^(password|passwd|pwd|secret|token|api[_-]?key|auth|credential|private[_-]?key|authorization)$/i`
 *
 * Copied here so the edge logger stays zero-dependency.
 */
const SENSITIVE_KEY_PATHS = [
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'apiKey',
  'api_key',
  'auth',
  'credential',
  'privateKey',
  'private_key',
  'authorization',
];

/**
 * Common request header paths that often carry secrets.
 */
const SENSITIVE_HEADER_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  'request.headers.authorization',
  'request.headers.cookie',
];

/**
 * Built-in redactor presets.
 *
 * - `default` — sensitive keys + request headers (passwords, tokens, secrets, auth headers)
 * - `strict` — default + bearer/jwt/api-key patterns nested at any depth
 * - `pci-dss` — credit card and payment-related fields
 */
export const REDACT_PRESETS: Record<RedactorPreset, RedactorOptions> = {
  /**
   * Default: covers the same sensitive-key names as the main autotel package's
   * `sensitiveKey` pattern, plus common request header paths.
   *
   * Redacted keys: password, passwd, pwd, secret, token, apiKey, auth,
   *                credential, privateKey, authorization
   * Redacted headers: req.headers.authorization, req.headers.cookie, etc.
   */
  default: {
    paths: [...SENSITIVE_KEY_PATHS, ...SENSITIVE_HEADER_PATHS],
  },

  /**
   * Strict: everything in default, plus nested paths for bearer tokens,
   * JWT fields, and API key fields at common depths.
   */
  strict: {
    paths: [
      ...SENSITIVE_KEY_PATHS,
      ...SENSITIVE_HEADER_PATHS,
      // Common nested auth shapes
      'bearer',
      'jwt',
      'apiSecret',
      'api_secret',
      'accessToken',
      'access_token',
      'refreshToken',
      'refresh_token',
      'clientSecret',
      'client_secret',
    ],
  },

  /**
   * PCI-DSS: credit card and payment-related fields.
   */
  'pci-dss': {
    paths: [
      'card',
      'cardNumber',
      'card_number',
      'ccn',
      'pan',
      'cvv',
      'cvc',
      'expirationDate',
      'expiration_date',
      'exp',
      'payment.card',
      'payment.cardNumber',
      'payment.cvv',
    ],
  },
};

/**
 * Resolve a preset name or explicit options into RedactorOptions.
 */
function resolveConfig(config: RedactorConfig): RedactorOptions {
  if (typeof config === 'string') {
    const preset = REDACT_PRESETS[config];
    if (!preset) {
      throw new Error(
        `Unknown redactor preset: "${config}". Available: ${Object.keys(REDACT_PRESETS).join(', ')}`,
      );
    }
    return preset;
  }
  return config;
}

/**
 * Create a redactor function from a list of paths.
 *
 * Paths use dot notation for nested fields and `[*]` or `*` for wildcards:
 * - `"password"` — top-level key
 * - `"user.email"` — nested field
 * - `"users[*].password"` or `"users.*.password"` — all items in array/object
 * - `"headers.authorization"` — nested header
 * - `"[*].secret"` — wildcard at root
 *
 * Overlapping paths are supported — e.g. `['user', 'user.email']` will
 * redact `user` as a whole while still recursing into `user.email`.
 *
 * The returned function clones plain objects/arrays before mutating,
 * so the original is never modified. Non-plain objects (Date, Map, etc.)
 * are passed through by reference.
 *
 * @example
 * ```typescript
 * // Using a preset
 * const redactor = createRedactor('default')
 *
 * // Using explicit paths
 * const redactor = createRedactor({
 *   paths: ['password', 'token', 'user.email', 'users[*].ssn'],
 *   censor: '[Filtered]',       // optional, default '[Redacted]'
 * })
 *
 * redactor({ password: 's3cret', user: { email: 'a@b.com' } })
 * // → { password: '[Filtered]', user: { email: '[Filtered]' } }
 *
 * // Custom censor function:
 * const mask = createRedactor({
 *   paths: ['ccn'],
 *   censor: (val) => '****' + String(val).slice(-4),
 * })
 * ```
 */
export function createRedactor(config: RedactorConfig): <T>(obj: T) => T {
  const { paths, censor = DEFAULT_CENSOR, remove = false } = resolveConfig(config);

  if (paths.length === 0) {
    return <T>(obj: T): T => obj;
  }

  const parsed = paths.map((p) => parsePath(p));
  const tree = buildPathTree(parsed);

  return function redactor<T>(obj: T): T {
    if (obj == null || typeof obj !== 'object') return obj;

    // Clone so we don't mutate the original log entry
    const clone = deepClone(obj) as Record<string, any>;
    redactWithTree(clone, tree, censor, remove);
    return clone as T;
  };
}
