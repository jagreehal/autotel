import { describe, it, expect } from 'vitest';
import { compareCohorts, type AnalysisEvent } from './analysis';

function events(
  count: number,
  attributes: AnalysisEvent,
  startId = 0,
): AnalysisEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    'request.id': `req-${startId + index}`,
    ...attributes,
  }));
}

describe('compareCohorts', () => {
  it('names the field that separates the outliers from the baseline', () => {
    const slow = events(20, {
      'payment.provider': 'bank-beta',
      region: 'eu-west-1',
    });
    const normal = [
      ...events(80, { 'payment.provider': 'bank-alpha', region: 'eu-west-1' }),
      ...events(
        20,
        { 'payment.provider': 'bank-beta', region: 'eu-west-1' },
        80,
      ),
    ];

    const [top] = compareCohorts({ outlier: slow, baseline: normal });

    expect(top?.field).toBe('payment.provider');
    expect(top?.value).toBe('bank-beta');
    expect(top?.outlierFraction).toBe(1);
    expect(top?.baselineFraction).toBeCloseTo(0.2);
    expect(top?.difference).toBeCloseTo(0.8);
  });

  it('ignores a field that holds the same value in both groups', () => {
    const outlier = events(10, { region: 'eu-west-1', tier: 'free' });
    const baseline = events(10, { region: 'eu-west-1', tier: 'paid' }, 10);

    const fieldsFound = compareCohorts({ outlier, baseline }).map(
      (difference) => difference.field,
    );

    expect(fieldsFound).toContain('tier');
    expect(fieldsFound).not.toContain('region');
  });

  it('drops unbounded fields that cannot describe a cohort', () => {
    const outlier = events(60, { tier: 'free' });
    const baseline = events(60, { tier: 'paid' }, 60);

    // request.id is unique per event, so it separates nothing.
    const fieldsFound = compareCohorts({ outlier, baseline }).map(
      (difference) => difference.field,
    );

    expect(fieldsFound).not.toContain('request.id');
  });

  it('skips nested values rather than stringifying them', () => {
    const outlier = events(10, { headers: { accept: 'json' } });
    const baseline = events(10, { headers: { accept: 'xml' } }, 10);

    expect(compareCohorts({ outlier, baseline })).toEqual([]);
  });

  it('returns nothing when either group is empty', () => {
    expect(
      compareCohorts({ outlier: [], baseline: events(10, { tier: 'free' }) }),
    ).toEqual([]);
    expect(
      compareCohorts({ outlier: events(10, { tier: 'free' }), baseline: [] }),
    ).toEqual([]);
  });

  it('reports a value that is missing from the outliers', () => {
    const outlier = events(10, { 'cache.result': 'miss' });
    const baseline = events(10, { 'cache.result': 'hit' }, 10);

    const hit = compareCohorts({ outlier, baseline }).find(
      (difference) => difference.value === 'hit',
    );

    expect(hit?.outlierCount).toBe(0);
    expect(hit?.difference).toBe(-1);
  });

  it('honours fields, ignoreFields, and limit', () => {
    const outlier = events(10, { tier: 'free', region: 'eu-west-1' });
    const baseline = events(10, { tier: 'paid', region: 'us-east-1' }, 10);

    expect(
      compareCohorts({ outlier, baseline, fields: ['tier'] }).every(
        (difference) => difference.field === 'tier',
      ),
    ).toBe(true);

    expect(
      compareCohorts({ outlier, baseline, ignoreFields: ['tier'] }).some(
        (difference) => difference.field === 'tier',
      ),
    ).toBe(false);

    expect(compareCohorts({ outlier, baseline, limit: 1 })).toHaveLength(1);
  });
});
