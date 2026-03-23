import { describe, it, expect } from 'vitest';
import { handleKey, type DashboardState } from './dashboard-keymap';

const baseState: DashboardState = {
  viewMode: 'trace',
  paused: false,
  recording: false,
  spanFilters: { statusGroup: 'all' },
};

describe('handleKey', () => {
  it('toggles view modes (t/l/v/E)', () => {
    expect(handleKey(baseState, 't').next.viewMode).toBe('span');
    expect(
      handleKey({ ...baseState, viewMode: 'span' }, 't').next.viewMode,
    ).toBe('trace');

    expect(handleKey(baseState, 'l').next.viewMode).toBe('log');
    expect(
      handleKey({ ...baseState, viewMode: 'log' }, 'l').next.viewMode,
    ).toBe('trace');

    expect(handleKey(baseState, 'v').next.viewMode).toBe('service-summary');
    expect(
      handleKey({ ...baseState, viewMode: 'service-summary' }, 'v').next
        .viewMode,
    ).toBe('trace');

    expect(handleKey(baseState, 'E').next.viewMode).toBe('errors');
    expect(
      handleKey({ ...baseState, viewMode: 'errors' }, 'E').next.viewMode,
    ).toBe('trace');
  });

  it('cycles status group with H', () => {
    const s1 = handleKey(baseState, 'H').next.spanFilters.statusGroup;
    const s2 = handleKey(
      { ...baseState, spanFilters: { statusGroup: s1 } },
      'H',
    ).next.spanFilters.statusGroup;
    const s3 = handleKey(
      { ...baseState, spanFilters: { statusGroup: s2 } },
      'H',
    ).next.spanFilters.statusGroup;
    const s4 = handleKey(
      { ...baseState, spanFilters: { statusGroup: s3 } },
      'H',
    ).next.spanFilters.statusGroup;

    expect([s1, s2, s3, s4]).toEqual(['2xx', '4xx', '5xx', 'all']);
  });

  it('clears filters with x', () => {
    const next = handleKey(
      { ...baseState, spanFilters: { statusGroup: '5xx', route: '/users' } },
      'x',
    ).next;
    expect(next.spanFilters.statusGroup).toBe('all');
    expect(next.spanFilters.route).toBeUndefined();
  });

  it('starts recording with r and clears buffers', () => {
    const res = handleKey(
      { ...baseState, paused: true, spanFilters: { statusGroup: '5xx' } },
      'r',
    );
    expect(res.next.recording).toBe(true);
    expect(res.next.paused).toBe(false);
    expect(res.next.spanFilters.statusGroup).toBe('all');
    expect(res.actions.some((a) => a.type === 'clearBuffers')).toBe(true);
  });

  it('x clears traceId filter', () => {
    const state: DashboardState = {
      ...baseState,
      spanFilters: { statusGroup: '5xx', traceId: 'some-trace' },
    };
    const res = handleKey(state, 'x');
    expect(res.next.spanFilters.traceId).toBeUndefined();
    expect(res.next.spanFilters.statusGroup).toBe('all');
  });
});
