import type { ExceptionRecord, SuppressionRule } from './types';

// Cache compiled regexes to avoid re-creating on every check
const regexCache = new Map<string, RegExp | null>();

function getCompiledRegex(pattern: string): RegExp | null {
  if (regexCache.has(pattern)) return regexCache.get(pattern)!;
  try {
    const re = new RegExp(pattern);
    regexCache.set(pattern, re);
    return re;
  } catch {
    regexCache.set(pattern, null);
    return null;
  }
}

function matchesRule(exception: ExceptionRecord, rule: SuppressionRule): boolean {
  const fieldValue = rule.key === 'type' ? exception.type : exception.value;

  switch (rule.operator) {
    case 'exact':
      return fieldValue === rule.value;
    case 'contains':
      return fieldValue.includes(rule.value);
    case 'regex': {
      const re = getCompiledRegex(rule.value);
      return re ? re.test(fieldValue) : false;
    }
    default:
      return false;
  }
}

export function isSuppressed(exception: ExceptionRecord, rules: SuppressionRule[]): boolean {
  return rules.some((rule) => matchesRule(exception, rule));
}
