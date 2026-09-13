import { describe, it, expect } from 'vitest';
import { keyAttributes } from './keyAttributes';

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
