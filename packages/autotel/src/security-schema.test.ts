import { describe, expect, it } from 'vitest';
import {
  SECURITY_ATTR,
  SECURITY_DENIED_STATUSES,
  SECURITY_SEVERITIES,
  SECURITY_SEVERITY_RANK,
  escalateSecuritySeverity,
  parseSecuritySeverity,
  securitySeverityAtLeast,
} from './security-schema';

describe('security-schema', () => {
  it('ranks severities in declaration order', () => {
    const ranks = SECURITY_SEVERITIES.map((s) => SECURITY_SEVERITY_RANK[s]);
    expect(ranks).toEqual([0, 1, 2, 3]);
  });

  it('parses valid severities and falls back on garbage', () => {
    expect(parseSecuritySeverity('critical')).toBe('critical');
    expect(parseSecuritySeverity('warning')).toBe('warning');
    expect(parseSecuritySeverity('CRITICAL')).toBe('info');
    expect(parseSecuritySeverity(42)).toBe('info');
    expect(parseSecuritySeverity(undefined)).toBe('info');
    expect(parseSecuritySeverity(undefined, 'warning')).toBe('warning');
  });

  it('compares severities against a threshold', () => {
    expect(securitySeverityAtLeast('error', 'warning')).toBe(true);
    expect(securitySeverityAtLeast('warning', 'warning')).toBe(true);
    expect(securitySeverityAtLeast('info', 'warning')).toBe(false);
  });

  it('escalates to the floor but never downgrades', () => {
    expect(escalateSecuritySeverity('info', 'error')).toBe('error');
    expect(escalateSecuritySeverity('error', 'error')).toBe('error');
    expect(escalateSecuritySeverity('critical', 'error')).toBe('critical');
  });

  it('keeps the attribute contract stable', () => {
    expect(SECURITY_ATTR.event).toBe('security.event');
    expect(SECURITY_ATTR.severity).toBe('security.severity');
    expect(SECURITY_ATTR.suspiciousRequest).toBe('security.suspicious_request');
    expect(SECURITY_DENIED_STATUSES).toEqual([401, 403, 429]);
  });
});
