import { describe, it, expect } from 'vitest';
import {
  keyAttributes,
  appAttributes,
  isResourceAttribute,
  isAppAttribute,
} from './keyAttributes';

describe('keyAttributes', () => {
  it('keeps display order, skips noise, truncates long values', () => {
    const long = 'x'.repeat(200);
    expect(
      keyAttributes({
        'user.email': 'a@b.c',
        model: 'm',
        'http.route': '/r',
        'db.statement': long,
      }),
    ).toEqual([
      ['http.route', '/r'],
      ['db.statement', `${'x'.repeat(120)}…`],
      ['model', 'm'],
    ]);
  });

  it('surfaces what Claude Code log events carry', () => {
    const shown = keyAttributes({
      'event.name': 'claude_code.tool_result',
      tool_name: 'Bash',
      success: true,
      duration_ms: 1510,
      cost_usd: 0.21,
      'session.id': 'sess',
    }).map(([k]) => k);
    expect(shown).toEqual(['tool_name', 'success', 'duration_ms', 'cost_usd']);
  });

  it('caps the number of pairs when asked', () => {
    expect(
      keyAttributes({ model: 'm', tool_name: 't', cost_usd: 1 }, 2),
    ).toHaveLength(2);
  });
});

describe('appAttributes', () => {
  it('keeps what the app set, drops resource and auto namespaces', () => {
    expect(
      appAttributes({
        'service.name': 'api',
        'deployment.environment': 'dev',
        'code.function': 'send',
        'http.route': '/r',
        'error.type': 'X',
        'user.id': 'u4',
        'statements.outcome': 'send_failed',
        retries: 2,
      }),
    ).toEqual([
      ['user.id', 'u4'],
      ['statements.outcome', 'send_failed'],
      ['retries', '2'],
    ]);
  });
});

describe('preview masking', () => {
  it('masks credential-shaped string values, keeps counts', () => {
    expect(
      appAttributes({
        'auth.token': 'eyJhbGciOi',
        password: 'hunter2',
        'billing.api_key': ['k1'],
        'quota.tokens_used': 42,
        'user.id': 'u4',
      }),
    ).toEqual([
      ['auth.token', '[redacted]'],
      ['password', '[redacted]'],
      ['billing.api_key', '[redacted]'],
      ['quota.tokens_used', '42'],
      ['user.id', 'u4'],
    ]);
  });

  it('keeps values whole', () => {
    const long = 'a'.repeat(200);
    expect(appAttributes({ id: long })[0]![1]).toBe(long);
  });
});

describe('attribute classification', () => {
  it('resource attributes are a subset of auto ones', () => {
    for (const key of ['service.name', 'k8s.pod.name', 'telemetry.sdk.name']) {
      expect(isResourceAttribute(key)).toBe(true);
      expect(isAppAttribute(key)).toBe(false);
    }
    // Auto-instrumentation, but not resource.
    expect(isResourceAttribute('http.route')).toBe(false);
    expect(isAppAttribute('http.route')).toBe(false);
  });
});
