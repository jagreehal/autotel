/**
 * Attribute Redacting Processor
 *
 * Automatically redacts PII and sensitive data from span attributes before export.
 * This is critical for compliance (GDPR, PCI-DSS, HIPAA) and data security.
 *
 * @example Basic usage with preset
 * ```typescript
 * init({
 *   service: 'my-app',
 *   attributeRedactor: 'default'
 * })
 * ```
 *
 * @example Custom patterns
 * ```typescript
 * init({
 *   service: 'my-app',
 *   attributeRedactor: {
 *     keyPatterns: [/password/i, /secret/i],
 *     valuePatterns: [
 *       { name: 'customerId', pattern: /CUST-\d{8}/g, replacement: 'CUST-***' }
 *     ]
 *   }
 * })
 * ```
 */

import type {
  SpanProcessor,
  ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import type { Context, AttributeValue, Attributes } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/sdk-trace-base';
import {
  asBoolean,
  asRecord,
  asString,
  isFunction,
  readProperty,
} from './values';

/**
 * Custom redactor function type. `attributes` is the whole attribute set of
 * the span being redacted, when there is one, for rules that depend on what
 * else the span says (which database a query ran against).
 */
export type AttributeRedactorFn = (
  key: string,
  value: AttributeValue,
  attributes?: Attributes,
) => AttributeValue;

/**
 * Built-in redactor preset names
 */
export type AttributeRedactorPreset = 'default' | 'strict' | 'pci-dss';

/**
 * Masker function type - receives the matched string and returns a masked version
 */
export type MaskFn = (match: string) => string;

/**
 * Value pattern configuration
 */
export interface ValuePatternConfig {
  /** Name for debugging/logging */
  name: string;
  /** Regex pattern to match in values */
  pattern: RegExp;
  /** Custom replacement (default: uses global replacement) */
  replacement?: string;
  /** Mask function for smart partial masking (overrides replacement) */
  mask?: MaskFn;
}

/**
 * Built-in PII pattern names
 */
export type BuiltinPatternName = keyof typeof builtinPatterns;

/**
 * Attribute redactor configuration
 */
export interface AttributeRedactorConfig {
  /**
   * Patterns to match against attribute keys (redacts entire value if key matches).
   * Each is tested against the full key and against its last dot segment, so
   * `/^password$/i` matches `password` and `user.password`.
   */
  keyPatterns?: RegExp[];

  /** Patterns to match against attribute values (redacts matched portion) */
  valuePatterns?: ValuePatternConfig[];

  /** Dot-notation paths to redact (e.g. 'user.password', 'payment.card') */
  paths?: string[];

  /** Built-in PII patterns to enable. `true` enables all, `false` disables all, array selects specific ones. */
  builtins?: boolean | BuiltinPatternName[];

  /** Custom RegExp patterns for string-level redaction */
  patterns?: RegExp[];

  /** Default replacement string (default: '[REDACTED]') */
  replacement?: string;

  /** Custom redactor function for full control */
  redactor?: AttributeRedactorFn;

  /**
   * Replace the literal values in MongoDB query text (`db.query.text`,
   * `db.statement` on a span whose `db.system` is `mongodb`) with `?`,
   * keeping its shape and field names. Prisma's MongoDB engine inlines every
   * value, so a lookup exports what it looked up and a write what it wrote;
   * no value pattern recognises a key hash or an amount. On in every preset.
   */
  mongoQueryLiterals?: boolean;

  /**
   * Replace every query parameter value in `url.full`, `url.query`,
   * `http.url` and `http.target` with `REDACTED`, keeping the names, as the
   * HTTP conventions recommend. Query strings carry account ids, emails and
   * signed tokens that no value pattern recognises. On in every preset.
   */
  urlQueryValues?: boolean;
}

/**
 * Processor options
 */
export interface AttributeRedactingProcessorOptions {
  redactor: AttributeRedactorConfig | AttributeRedactorPreset;
}

/**
 * Built-in patterns for detecting sensitive data
 */
export const REDACTOR_PATTERNS = {
  // Value patterns (match content in attribute values)
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi,
  phone: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
  ssn: /\b\d{3}[-]?\d{2}[-]?\d{4}\b/g,
  creditCard: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g,
  bearerToken: /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  apiKeyInValue: /(?:api[_-]?key|apikey|api_secret)[=:][\s"']*[A-Za-z0-9_-]+/gi,
  jwt: /eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g,

  // Key patterns (match attribute names - redacts entire value)
  sensitiveKey:
    /^(password|passwd|pwd|secret|token|api[_-]?key|auth|credential|private[_-]?key|authorization)$/i,
} as const;

const MASK_FIRST = new Set<string>(['bearer', 'iban']);

/**
 * Built-in PII detection patterns with smart masking.
 * Each builtin preserves just enough signal for debugging while scrubbing PII.
 * They run on every string attribute, so each must stay linear in the input length.
 */
export const builtinPatterns = {
  /** Credit card numbers → ****1111 (PCI DSS: last 4 allowed) */
  creditCard: {
    pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    mask: (m: string) => `****${m.replaceAll(/[\s-]/g, '').slice(-4)}`,
  },
  /** Email addresses → a***@***.com */
  email: {
    // A match starts only where a run of local-part characters starts, so no
    // run is rescanned and an overlong local part masks whole. Letters-only
    // TLD, so pnpm store segments like `name@1.2.3` are not addresses.
    pattern:
      /(?<![\w.+-])[\w.+-]+@[\w-]{1,63}(?:\.[\w-]{1,63})*\.[a-zA-Z]{2,63}(?![a-zA-Z])/g,
    mask: (m: string) => {
      const at = m.indexOf('@');
      if (at < 1) return '***@***';
      const tld = m.slice(m.lastIndexOf('.'));
      return `${m[0]}***@***${tld}`;
    },
  },
  /** IPv4 addresses → ***.***.***.100 (last octet only) */
  ipv4: {
    pattern:
      /\b(?!0\.0\.0\.0\b)(?!127\.0\.0\.1\b)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    mask: (m: string) => `***.***.***.${m.split('.').pop()}`,
  },
  /**
   * International / formatted phone numbers.
   *
   * Matches:
   * - `+33 1 23 45 67 89` -> `+33******89`
   * - `(415) 555-1234` -> `********34`
   * - `555-123-4567` / `555.123.4567` / `5551234567` -> `********67`
   *
   * Bare short digit runs like `12345678` are intentionally not matched.
   */
  phone: {
    pattern:
      /(?:\+\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}|\(\d{1,4}\)(?:[\s.-]?\d{2,4}){2,4}|\b\d{3}[-.]?\d{3}[-.]?\d{4}\b)/g,
    mask: (m: string) => {
      const digits = m.replaceAll(/[^\d]/g, '');
      const hasPlus = m.startsWith('+');
      if (hasPlus && digits.length > 4) {
        const ccMatch = m.match(/^\+\d{1,3}/);
        const cc = ccMatch ? ccMatch[0] : '+';
        return `${cc}******${digits.slice(-2)}`;
      }
      if (digits.length > 2) {
        return `${'*'.repeat(digits.length - 2)}${digits.slice(-2)}`;
      }
      return '***';
    },
  },
  /** JWT tokens → eyJ***.*** */
  jwt: {
    // The header stops at the next `-eyJ`, where another match could start,
    // so no start position rescans it.
    pattern: /\beyJ(?:(?!-eyJ)[\w-])*\.[\w-]*\.[\w-]*\b/g,
    mask: () => 'eyJ***.***',
  },
  /** Bearer tokens → Bearer *** */
  bearer: {
    pattern: /\bBearer\s+[\w\-.~+/]{8,}=*/gi,
    mask: () => 'Bearer ***',
  },
  /** IBAN → FR76****189 (country + check digits + last 3) */
  iban: {
    pattern:
      /\b[A-Z]{2}\d{2}[\s-]?[\dA-Z]{4}[\s-]?[\dA-Z]{4}[\s-]?[\dA-Z]{4}[\s-]?[\dA-Z]{0,4}[\s-]?[\dA-Z]{0,4}[\s-]?[\dA-Z]{0,4}\b/g,
    mask: (m: string) => {
      const clean = m.replaceAll(/[\s-]/g, '');
      return `${clean.slice(0, 4)}****${clean.slice(-3)}`;
    },
  },
} as const;

function cloneRegex(re: RegExp): RegExp {
  return new RegExp(re.source, re.flags);
}

function toRegExp(value: unknown): RegExp | undefined {
  if (value instanceof RegExp) return value;
  const literal = asString(value);
  if (literal !== undefined) return new RegExp(literal, 'g');
  // A regex that has been through JSON keeps its source and flags as fields.
  const source = asString(readProperty(value, 'source'));
  return source === undefined
    ? undefined
    : new RegExp(source, asString(readProperty(value, 'flags')) ?? 'g');
}

function toRegExpArray(value: unknown): RegExp[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: RegExp[] = [];
  for (const item of value) {
    const re = toRegExp(item);
    if (re) out.push(re);
  }
  return out.length > 0 ? out : [];
}

function builtinToValuePattern(name: BuiltinPatternName): ValuePatternConfig {
  const b = builtinPatterns[name];
  return { name, pattern: cloneRegex(b.pattern), mask: b.mask };
}

/**
 * Default value patterns for the 'default' preset
 */
const DEFAULT_VALUE_PATTERNS: ValuePatternConfig[] = [
  builtinToValuePattern('email'),
  builtinToValuePattern('phone'),
  { name: 'ssn', pattern: REDACTOR_PATTERNS.ssn },
  builtinToValuePattern('creditCard'),
];

/**
 * Built-in redactor presets
 */
export const REDACTOR_PRESETS = {
  /**
   * Default preset - covers common PII patterns with smart masking
   * Detects: emails (a***@***.com), phone numbers, SSNs, credit cards (****1111)
   * Redacts keys: password, secret, token, apiKey, auth, credential
   */
  default: {
    keyPatterns: [REDACTOR_PATTERNS.sensitiveKey],
    valuePatterns: DEFAULT_VALUE_PATTERNS,
    builtins: true,
    replacement: '[REDACTED]',
    mongoQueryLiterals: true,
    urlQueryValues: true,
  },

  /**
   * Strict preset - more aggressive redaction for high-security environments
   * Includes everything in default plus: Bearer tokens, JWTs, IBAN, API keys in values
   */
  strict: {
    keyPatterns: [REDACTOR_PATTERNS.sensitiveKey, /bearer/i, /jwt/i],
    valuePatterns: [
      ...DEFAULT_VALUE_PATTERNS,
      builtinToValuePattern('jwt'),
      builtinToValuePattern('bearer'),
      builtinToValuePattern('iban'),
      { name: 'apiKeyInValue', pattern: REDACTOR_PATTERNS.apiKeyInValue },
    ],
    builtins: true,
    replacement: '[REDACTED]',
    mongoQueryLiterals: true,
    urlQueryValues: true,
  },

  /**
   * PCI-DSS preset - focused on payment card industry compliance
   * Redacts: credit card numbers (****1111), CVV-like patterns, card-related keys
   */
  'pci-dss': {
    keyPatterns: [/card/i, /cvv/i, /cvc/i, /pan/i, /expir/i, /ccn/i],
    valuePatterns: [builtinToValuePattern('creditCard')],
    builtins: ['creditCard'],
    replacement: '[REDACTED]',
    mongoQueryLiterals: true,
    urlQueryValues: true,
  },
} satisfies Record<AttributeRedactorPreset, AttributeRedactorConfig>;

/**
 * Normalize redactor config that may have been deserialized from JSON/YAML.
 * Converts regex-like values back to RegExp instances.
 */
export function normalizeAttributeRedactorConfig(
  raw: AttributeRedactorConfig | AttributeRedactorPreset | unknown,
): AttributeRedactorConfig | AttributeRedactorPreset | undefined {
  if (raw === undefined || raw === null) return undefined;
  const presetName = asString(raw);
  if (presetName !== undefined) {
    // SAFETY: a string config names one of the built-in presets; resolving it
    // below returns undefined when the name is not one of them.
    return presetName as AttributeRedactorPreset;
  }
  const record = asRecord(raw);
  if (!record) return undefined;

  const config: AttributeRedactorConfig = {};

  if (Array.isArray(record.paths)) {
    config.paths = record.paths.filter(
      (value): value is string => asString(value) !== undefined,
    );
  }

  const replacement = asString(record.replacement);
  if (replacement !== undefined) config.replacement = replacement;

  const builtins = asBoolean(record.builtins);
  if (builtins !== undefined) {
    config.builtins = builtins;
  } else if (Array.isArray(record.builtins)) {
    config.builtins = record.builtins.filter(
      (name): name is BuiltinPatternName => asString(name) !== undefined,
    );
  }

  const urlQueryValues = asBoolean(record.urlQueryValues);
  if (urlQueryValues !== undefined) config.urlQueryValues = urlQueryValues;

  const mongoQueryLiterals = asBoolean(record.mongoQueryLiterals);
  if (mongoQueryLiterals !== undefined) {
    config.mongoQueryLiterals = mongoQueryLiterals;
  }

  if (isFunction(record.redactor)) {
    // SAFETY: the guard above established `redactor` is callable.
    config.redactor = record.redactor as AttributeRedactorFn;
  }

  const keyPatterns = toRegExpArray(record.keyPatterns);
  if (keyPatterns) config.keyPatterns = keyPatterns;

  const patterns = toRegExpArray(record.patterns);
  if (patterns) config.patterns = patterns;

  if (Array.isArray(record.valuePatterns)) {
    const valuePatterns: ValuePatternConfig[] = [];
    for (const entry of record.valuePatterns) {
      const item = asRecord(entry);
      const name = asString(item?.name);
      const pattern = toRegExp(item?.pattern);
      if (!item || name === undefined || !pattern) continue;
      valuePatterns.push({
        name,
        pattern,
        replacement: asString(item.replacement),
        // SAFETY: the probe on this line is what establishes the mask is callable.
        mask: isFunction(item.mask) ? (item.mask as MaskFn) : undefined,
      });
    }
    config.valuePatterns = valuePatterns;
  }

  return config;
}

/**
 * Resolve config to a normalized form
 */
function resolveConfig(
  config: AttributeRedactorConfig | AttributeRedactorPreset,
): AttributeRedactorConfig {
  const normalized = normalizeAttributeRedactorConfig(config);
  if (!normalized) {
    throw new Error('Invalid attribute redactor config');
  }

  // typeof, not asString: this narrows a union of a preset name and a config
  // object, and only the operator TypeScript understands does that.
  if (typeof normalized === 'string') {
    const preset = REDACTOR_PRESETS[normalized];
    if (!preset) {
      throw new Error(
        `Unknown attribute redactor preset: "${normalized}". ` +
          `Available presets: ${Object.keys(REDACTOR_PRESETS).join(', ')}`,
      );
    }
    return preset;
  }

  const resolvedConfig: AttributeRedactorConfig = {
    ...normalized,
    keyPatterns: normalized.keyPatterns
      ? [...normalized.keyPatterns]
      : undefined,
    valuePatterns: normalized.valuePatterns
      ? [...normalized.valuePatterns]
      : undefined,
    paths: normalized.paths ? [...normalized.paths] : undefined,
    patterns: normalized.patterns ? [...normalized.patterns] : undefined,
  };

  // Merge built-in patterns if enabled
  if (resolvedConfig.builtins !== false) {
    // SAFETY: the keys of the builtin table are its own pattern names.
    const builtinNames = Array.isArray(resolvedConfig.builtins)
      ? resolvedConfig.builtins
      : (Object.keys(builtinPatterns) as BuiltinPatternName[]);
    const builtinValuePatterns = builtinNames
      .filter((name) => name in builtinPatterns)
      .map((name) => builtinToValuePattern(name));

    resolvedConfig.valuePatterns = [
      ...(resolvedConfig.valuePatterns ?? []),
      ...builtinValuePatterns,
    ];
  }

  return resolvedConfig;
}

/**
 * A key pattern matches the full attribute key or its last dot segment, so an
 * anchored name pattern (`^password$`) also catches `user.password` and
 * `http.request.header.authorization`. Only the last segment: `auth.method`
 * names metadata about auth, not a credential.
 */
function keyIsSensitive(key: string, keyPatterns: RegExp[]): boolean {
  const lastSegment = key.slice(key.lastIndexOf('.') + 1);
  return keyPatterns.some((pattern) => {
    pattern.lastIndex = 0;
    if (pattern.test(key)) return true;
    pattern.lastIndex = 0;
    return lastSegment !== key && pattern.test(lastSegment);
  });
}

/**
 * Create a redactor function from config
 */
function createRedactorFromConfig(
  config: AttributeRedactorConfig,
): AttributeRedactorFn {
  // If custom redactor provided, use it directly
  if (config.redactor) {
    return config.redactor;
  }

  const keyPatterns = config.keyPatterns ?? [];
  const valuePatterns = config.valuePatterns ?? [];
  const paths = config.paths ?? [];
  const pathSet = new Set(paths);
  const customPatterns = config.patterns ?? [];
  const defaultReplacement = config.replacement ?? '[REDACTED]';

  // Build masker list from valuePatterns that have mask functions. Bearer and
  // IBAN mask first, whole, before the card and JWT patterns see parts of
  // them. The sort is stable, so the rest keep their order.
  const maskers: [RegExp, MaskFn][] = valuePatterns
    .filter((vp) => vp.mask)
    .toSorted(
      (a, b) => Number(MASK_FIRST.has(b.name)) - Number(MASK_FIRST.has(a.name)),
    )
    .map((vp) => [cloneRegex(vp.pattern), vp.mask!]);

  return (
    key: string,
    original: AttributeValue,
    attributes?: Attributes,
  ): AttributeValue => {
    let value =
      config.mongoQueryLiterals && isMongoQueryText(key, original, attributes)
        ? scrubMongoQueryLiterals(String(original))
        : original;
    const urlText = asString(value);
    if (config.urlQueryValues && urlText !== undefined && URL_KEYS.has(key)) {
      value = redactQueryValues(urlText, key === 'url.query');
    }

    // Key-pattern and path-based redaction only applies to string values.
    // Numbers, booleans and other non-string attributes are not credentials;
    // replacing them with the string '[REDACTED]' silently changes their
    // type and corrupts downstream consumers (LLM token counters etc.).
    // String arrays count too: semconv headers (`http.request.header.*`) are
    // string[], and each element is replaced so the type survives.
    const text = asString(value);
    const isStringArray =
      Array.isArray(value) &&
      value.every((item) => asString(item) !== undefined);
    if (
      (text !== undefined || isStringArray) &&
      (keyIsSensitive(key, keyPatterns) || pathSet.has(key))
    ) {
      return Array.isArray(value)
        ? value.map(() => defaultReplacement)
        : defaultReplacement;
    }

    // For non-string values, return as-is
    if (text === undefined) {
      if (Array.isArray(value)) {
        // SAFETY: redacting each element of an attribute array yields an array
        // of the same kind; redactStringValue returns a string for a string.
        return value.map((item) => {
          const itemText = asString(item);
          return itemText === undefined
            ? item
            : redactStringValue(
                itemText,
                valuePatterns,
                maskers,
                customPatterns,
                defaultReplacement,
              );
        }) as AttributeValue;
      }
      return value;
    }

    // Three-tier strategy: path-based → masker-based → pattern-based
    return redactStringValue(
      text,
      valuePatterns,
      maskers,
      customPatterns,
      defaultReplacement,
    );
  };
}

const QUERY_TEXT_KEYS = new Set(['db.query.text', 'db.statement']);
const URL_KEYS = new Set(['url.full', 'url.query', 'http.url', 'http.target']);

/**
 * `text` with each query (and fragment) parameter's value replaced by
 * `REDACTED`. `text` is a URL or target unless `queryOnly`, when it is the
 * query string itself.
 */
function redactQueryValues(text: string, queryOnly: boolean): string {
  if (queryOnly) return redactPairs(text);
  const hash = text.indexOf('#');
  const path = hash === -1 ? text : text.slice(0, hash);
  const fragment = hash === -1 ? '' : `#${redactPairs(text.slice(hash + 1))}`;
  const query = path.indexOf('?');
  return (
    (query === -1
      ? path
      : path.slice(0, query + 1) + redactPairs(path.slice(query + 1))) +
    fragment
  );
}

/** `a=1&b` as `a=REDACTED&b`: a name without `=` has no value to replace. */
function redactPairs(pairs: string): string {
  return pairs
    .split('&')
    .map((pair) => {
      const equals = pair.indexOf('=');
      return equals === -1 ? pair : `${pair.slice(0, equals + 1)}REDACTED`;
    })
    .join('&');
}

function isMongoQueryText(
  key: string,
  value: AttributeValue,
  attributes: Attributes | undefined,
): boolean {
  if (!QUERY_TEXT_KEYS.has(key) || asString(value) === undefined) return false;
  const system = attributes?.['db.system.name'] ?? attributes?.['db.system'];
  return system === 'mongodb';
}

/** A `$`-string kept as a field reference: `$name`, `$a.b`, `$$ROOT.items`. */
const FIELD_PATH = /^\$\$?[A-Za-z_][\w.]*$/;
/** The colon after a key, from where the scan stands. */
const KEY_COLON = /\s*:\s*/y;
/** A bare key, as the shell writes it. */
const BARE_KEY = /[$A-Za-z_][\w$.]*(?=\s*:)/y;
/**
 * Keys whose value MongoDB evaluates as an aggregation expression, where a
 * `$`-string is a field path. Everywhere else (a filter, an update) it is the
 * value itself. `$set` stays out: in an update it writes its operand.
 */
const EXPRESSION_KEYS = new Set([
  '$expr',
  '$project',
  '$group',
  '$addFields',
  '$replaceRoot',
  '$replaceWith',
  '$bucket',
  '$bucketAuto',
  '$sortByCount',
  '$unwind',
  '$lookup',
  '$graphLookup',
  '$redact',
  '$setWindowFields',
]);
/** `$literal` as a bare key, as the shell writes it. */
const BARE_LITERAL_KEY = /\$literal(?=\s*:)/y;
/** A number, boolean, null or regex, ending where a value ends. */
const SCALAR =
  /(?:-?(?:0[xX][\da-fA-F]+|\d+n|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|Infinity)|NaN|true|false|null|undefined|\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+\/[a-z]*)(?=\s*[,\]})])/y;

/**
 * MongoDB shell-style query text with every literal value replaced by `?`:
 * `{ $eq: [ "$keyHmac", { $literal: "9f…" } ] }` becomes
 * `{ $eq: [ "$keyHmac", { $literal: ? } ] }`. Object keys, operators, and
 * field references inside `$expr` and expression stages stay, so the query is still readable and groups. A `$literal`
 * goes whole, whatever it holds: it is a value by definition, `$` or not.
 *
 * One pass, left to right, that steps over each string whole: whatever a
 * string contains (quotes, colons, `$literal`, digits) is that string's
 * content, never structure.
 */
export function scrubMongoQueryLiterals(text: string): string {
  let out = '';
  let index = 0;
  // The last character emitted outside whitespace: a value follows `:`, `[`,
  // `,` or `(`, and a bare key does not follow an identifier character.
  let previous = '';
  let lastKey = '';
  // Per open bracket: whether a `$`-string inside it is a field path.
  const expression = [false];
  /** Whether the value starting here is read as an expression. */
  const inExpression = () =>
    expression.at(-1)! || (previous === ':' && EXPRESSION_KEYS.has(lastKey));

  /** At a `$literal` key's colon: keep the colon, replace the operand whole. */
  const replaceOperand = () => {
    KEY_COLON.lastIndex = index;
    const colon = KEY_COLON.exec(text)![0];
    out += `${colon}?`;
    index = endOfValue(text, index + colon.length);
    previous = '?';
  };

  while (index < text.length) {
    const char = text[index]!;

    if (char === '"' || char === "'") {
      const end = endOfString(text, index) + 1;
      const quoted = text.slice(index, end);
      const content = quoted.slice(1, -1);
      index = end;
      KEY_COLON.lastIndex = end;
      if (KEY_COLON.test(text)) {
        out += quoted;
        previous = char;
        lastKey = content;
        if (content === '$literal') replaceOperand();
      } else {
        out += inExpression() && FIELD_PATH.test(content) ? quoted : '?';
        previous = '?';
      }
      continue;
    }

    BARE_LITERAL_KEY.lastIndex = index;
    if (!/[\w$]/.test(previous) && BARE_LITERAL_KEY.test(text)) {
      out += '$literal';
      index += '$literal'.length;
      replaceOperand();
      continue;
    }

    BARE_KEY.lastIndex = index;
    const key = /[{,]/.test(previous) ? BARE_KEY.exec(text) : null;
    if (key) {
      out += key[0];
      index += key[0].length;
      lastKey = key[0];
      previous = key[0].at(-1)!;
      continue;
    }

    SCALAR.lastIndex = index;
    const scalar = /[:[,(]/.test(previous) ? SCALAR.exec(text) : null;
    if (scalar) {
      out += '?';
      index += scalar[0].length;
      previous = '?';
      continue;
    }

    if (char === '{' || char === '[') expression.push(inExpression());
    else if ((char === '}' || char === ']') && expression.length > 1) {
      expression.pop();
    }
    out += char;
    if (!/\s/.test(char)) previous = char;
    index++;
  }
  return out;
}

/** Where the value starting at `start` ends: a string, a bracketed value, a call such as `ObjectId("…")`, or a bare token. */
function endOfValue(text: string, start: number): number {
  let depth = 0;
  for (let index = start; index < text.length; index++) {
    const char = text[index]!;
    if (char === '"' || char === "'") {
      index = endOfString(text, index);
      if (depth === 0) return index + 1;
    } else if (char === '{' || char === '[' || char === '(') {
      depth++;
    } else if (char === '}' || char === ']' || char === ')') {
      if (depth === 0) return trimEnd(text, start, index);
      if (--depth === 0) return index + 1;
    } else if (char === ',' && depth === 0) {
      return trimEnd(text, start, index);
    }
  }
  return text.length;
}

function endOfString(text: string, open: number): number {
  for (let index = open + 1; index < text.length; index++) {
    if (text[index] === '\\') index++;
    else if (text[index] === text[open]) return index;
  }
  return text.length - 1;
}

/** `end`, moved back over whitespace that is not part of the value. */
function trimEnd(text: string, start: number, end: number): number {
  while (end > start && /\s/.test(text[end - 1]!)) end--;
  return end;
}

/**
 * Apply three-tier redaction strategy to a string
 * 1. Masker-based: built-in patterns with smart partial masking
 * 2. Pattern-based: custom RegExp patterns replaced with replacement
 */
function redactStringValue(
  value: string,
  patterns: ValuePatternConfig[],
  maskers: [RegExp, MaskFn][],
  customPatterns: RegExp[],
  defaultReplacement: string,
): string {
  let result = value;

  // Tier 1: Apply maskers (smart partial masking)
  for (const [pattern, mask] of maskers) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, mask);
  }

  // Tier 2: Apply value patterns without mask (full replacement)
  for (const { pattern, replacement, mask } of patterns) {
    if (mask) continue; // Already handled by maskers
    pattern.lastIndex = 0;
    result = result.replaceAll(pattern, replacement ?? defaultReplacement);
  }

  // Tier 3: Apply custom patterns
  for (const pattern of customPatterns) {
    pattern.lastIndex = 0;
    result = result.replaceAll(pattern, defaultReplacement);
  }

  return result;
}

/**
 * Create a proxy wrapper around ReadableSpan with redacted attributes
 *
 * Since ReadableSpan.attributes is readonly, we use a Proxy to intercept
 * attribute access and return the redacted version.
 */
function createRedactedSpan(
  span: ReadableSpan,
  redactor: AttributeRedactorFn,
): ReadableSpan {
  const redact = (
    attributes: Attributes | undefined,
  ): Attributes | undefined => {
    if (!attributes) return attributes;
    const redacted: Attributes = {};
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined) {
        redacted[key] = redactor(key, value, attributes);
      }
    }
    return redacted;
  };

  // Pre-compute (cached for efficiency). Events and links carry attributes
  // too, such as the fields the request logger copies onto `log.emit.manual`.
  const redactedAttributes = redact(span.attributes);
  const redactedEvents = span.events.map((event) => ({
    ...event,
    attributes: redact(event.attributes),
  }));
  const redactedLinks = span.links.map((link) => ({
    ...link,
    attributes: redact(link.attributes),
  }));

  // Return a proxy that intercepts attribute access
  return new Proxy(span, {
    get(target, prop) {
      if (prop === 'attributes') return redactedAttributes;
      if (prop === 'events') return redactedEvents;
      if (prop === 'links') return redactedLinks;
      // For all other properties, delegate to the original span
      // SAFETY: a proxy get trap forwards whatever key it was asked for, which
      // is what Reflect.get exists for; the value is redacted before it is
      // returned, never read as a particular type here.
      const value = Reflect.get(target, prop);
      // Bind methods to the original target
      return isFunction(value) ? value.bind(target) : value;
    },
  });
}

/**
 * Create an attribute redactor function from a config or preset.
 *
 * This is useful when you need to apply the same redaction logic
 * outside of the span processor pipeline (e.g., for canonical log lines).
 *
 * @example
 * ```typescript
 * const redactor = createAttributeRedactor('default');
 * const redactedValue = redactor('user.password', 'secret123');
 * // redactedValue === '[REDACTED]'
 * ```
 */
export function createAttributeRedactor(
  config: AttributeRedactorConfig | AttributeRedactorPreset,
): AttributeRedactorFn {
  return createRedactorFromConfig(resolveConfig(config));
}

/**
 * Whether a config's explicit rules (key patterns and paths) mark a key as
 * sensitive, for redacting a whole object under it. Only explicit rules: what
 * a custom `redactor` returns cannot say whether it singled a key out (it may
 * echo the key, prefix every value, or anything else). Alongside a custom
 * `redactor`, declare `keyPatterns` or `paths` for the keys whose whole value
 * must be redacted; otherwise each leaf reaches it under its dotted key.
 */
export function createSensitiveKeyTest(
  config: AttributeRedactorConfig | AttributeRedactorPreset,
): (key: string) => boolean {
  const resolved = resolveConfig(config);
  const keyPatterns = resolved.keyPatterns ?? [];
  const paths = new Set(resolved.paths);
  return (key) =>
    key !== '' && (keyIsSensitive(key, keyPatterns) || paths.has(key));
}

/**
 * Span processor that redacts sensitive data from span attributes.
 *
 * Redaction happens in onEnd() when all attributes are finalized.
 * Uses a Proxy wrapper to intercept attribute access since ReadableSpan
 * attributes are readonly.
 *
 * Common use cases:
 * - PII compliance (GDPR, CCPA)
 * - PCI-DSS compliance for payment data
 * - Preventing secrets from leaking to observability backends
 */
export class AttributeRedactingProcessor implements SpanProcessor {
  private readonly wrappedProcessor: SpanProcessor;
  private readonly redactor: AttributeRedactorFn;

  constructor(
    wrappedProcessor: SpanProcessor,
    options: AttributeRedactingProcessorOptions,
  ) {
    this.wrappedProcessor = wrappedProcessor;
    const config = resolveConfig(options.redactor);
    this.redactor = createRedactorFromConfig(config);
  }

  /**
   * Pass through onStart unchanged - attributes aren't finalized yet
   */
  onStart(span: Span, parentContext: Context): void {
    this.wrappedProcessor.onStart(span, parentContext);
  }

  /**
   * Redact attributes and forward to wrapped processor
   */
  onEnd(span: ReadableSpan): void {
    try {
      const redactedSpan = createRedactedSpan(span, this.redactor);
      this.wrappedProcessor.onEnd(redactedSpan);
    } catch {
      // Fail-open: if redaction fails, forward original span
      // This ensures we don't lose telemetry due to redaction errors
      this.wrappedProcessor.onEnd(span);
    }
  }

  forceFlush(): Promise<void> {
    return this.wrappedProcessor.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.wrappedProcessor.shutdown();
  }
}

/**
 * Export createRedactedSpan for advanced users who want to use it directly
 */
export { createRedactedSpan };
