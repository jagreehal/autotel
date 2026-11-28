/**
 * Browser-safe string redaction. Duplicate of autotel's redact-values.ts.
 * Must NOT import from `autotel` (Node.js package).
 */

export type StringRedactor = (value: string) => string;

export type RedactorPreset = 'default' | 'strict' | 'pci-dss';

export interface ValuePatternConfig {
  name: string;
  pattern: RegExp;
  replacement?: string;
}

export interface RedactorConfig {
  valuePatterns?: ValuePatternConfig[];
  replacement?: string;
}
const REDACTOR_PATTERNS = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi,
  phone: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
  ssn: /\b\d{3}[-]?\d{2}[-]?\d{4}\b/g,
  // Not followed by another digit group, so a UUID's digit groups are not a card.
  // No lookbehind: Safari before 16.4 cannot parse one.
  creditCard: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}(?!\w|-\w)/g,
  bearerToken: /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  apiKeyInValue: /(?:api[_-]?key|apikey|api_secret)[=:][\s"']*[A-Za-z0-9_-]+/gi,
  jwt: /eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g,
} as const;

const DEFAULT_VALUE_PATTERNS: ValuePatternConfig[] = [
  { name: 'email', pattern: REDACTOR_PATTERNS.email },
  { name: 'phone', pattern: REDACTOR_PATTERNS.phone },
  { name: 'ssn', pattern: REDACTOR_PATTERNS.ssn },
  { name: 'creditCard', pattern: REDACTOR_PATTERNS.creditCard },
];

const REDACTOR_PRESETS = {
  default: {
    valuePatterns: DEFAULT_VALUE_PATTERNS,
    replacement: '[REDACTED]',
  },
  strict: {
    valuePatterns: [
      ...DEFAULT_VALUE_PATTERNS,
      { name: 'bearerToken', pattern: REDACTOR_PATTERNS.bearerToken },
      { name: 'apiKeyInValue', pattern: REDACTOR_PATTERNS.apiKeyInValue },
      { name: 'jwt', pattern: REDACTOR_PATTERNS.jwt },
    ],
    replacement: '[REDACTED]',
  },
  'pci-dss': {
    valuePatterns: [
      { name: 'creditCard', pattern: REDACTOR_PATTERNS.creditCard },
    ],
    replacement: '[REDACTED]',
  },
} satisfies Record<RedactorPreset, RedactorConfig>;

export function createStringRedactor(
  config: RedactorConfig | RedactorPreset,
): StringRedactor {
  const resolved =
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- discriminating the public `RedactorConfig | RedactorPreset` union the app passed: a preset name or a config
    typeof config === 'string' ? REDACTOR_PRESETS[config] : config;
  const valuePatterns: ValuePatternConfig[] = resolved.valuePatterns ?? [];
  const defaultReplacement = resolved.replacement ?? '[REDACTED]';

  return (value: string): string => {
    let result = value;
    for (const { pattern, replacement } of valuePatterns) {
      pattern.lastIndex = 0;
      result = result.replace(pattern, replacement ?? defaultReplacement);
    }
    return result;
  };
}
