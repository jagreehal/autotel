import { describe, expect, it } from 'vitest';
import {
  buildQueryGroups,
  explainGuidance,
  indexReason,
  stageTone,
  examinedRatioLabel,
  examinedSeverity,
  prettyStatement,
  repeatedStatementCounts,
  sortQueryGroups,
  trendPoints,
} from '../utils/queries';
import { sampleQueryTraces } from '../components/__fixtures__/queries';

describe('query utils', () => {
  const traces = sampleQueryTraces(1_000_000);

  it('groups every database span across traces by statement', () => {
    const groups = buildQueryGroups(traces);
    expect(groups.map((group) => [group.collection, group.count])).toEqual([
      ['orders', 2],
      ['comments', 5],
      ['audit', 1],
      ['posts', 1],
      ['audit', 1],
      [undefined, 1],
    ]);
    expect(groups[0]!.namespace).toBe('shop');
    const orders = groups[0]!;
    expect(orders.fullScanCount).toBe(1);
    expect(orders.planHashes).toHaveLength(2);
    expect(orders.plan?.indexes).toEqual(['status_1_createdAt_-1_total_1']);
    expect(groups[1]!.maxPerTrace).toBe(5);
  });

  it('sorts worst plan first, then by total time', () => {
    const sorted = sortQueryGroups(buildQueryGroups(traces), 'plan');
    expect(sorted[0]!.collection).toBe('orders');
    expect(
      sortQueryGroups(buildQueryGroups(traces), 'count')[0]!.collection,
    ).toBe('comments');
  });

  it('rates rows examined per row returned', () => {
    expect(examinedSeverity(16, 16)).toBe('ok');
    expect(examinedSeverity(400, 16)).toBe('warn');
    expect(examinedSeverity(60_000, 16)).toBe('bad');
    expect(examinedSeverity(10, 0)).toBe('ok');
    expect(examinedRatioLabel(60_000, 16)).toBe('3750:1');
    expect(examinedRatioLabel(3, 2)).toBe('1.5:1');
  });

  it('buckets run times over a fixed range', () => {
    const points = trendPoints([0, 1, 9, 10], 0, 10, 5);
    expect(points.map((point) => point.value)).toEqual([2, 0, 0, 0, 2]);
    expect(trendPoints([-5], 0, 10, 2).map((point) => point.value)).toEqual([
      0, 0,
    ]);
  });

  it('indents a MongoDB statement and leaves SQL alone', () => {
    expect(prettyStatement('{"a":"?"}')).toEqual({
      text: '{\n  "a": "?"\n}',
      isJson: true,
    });
    expect(prettyStatement('select 1')).toEqual({
      text: 'select 1',
      isJson: false,
    });
    expect(prettyStatement('{"truncated')).toEqual({
      text: '{"truncated',
      isJson: false,
    });
  });

  it('marks only the spans whose statement repeated in the trace', () => {
    const counts = repeatedStatementCounts(traces[0]!);
    expect(counts.get('c0')).toBe(5);
    expect(counts.has('p')).toBe(false);
    expect(counts.has('root')).toBe(false);
  });
});

describe('plan presentation', () => {
  it('picks out the stages a missing index causes', () => {
    expect(stageTone('COLLSCAN')).toBe('scan');
    expect(stageTone('Seq Scan')).toBe('scan');
    expect(stageTone('SORT')).toBe('sort');
    expect(stageTone('Incremental Sort')).toBe('sort');
    expect(stageTone('IXSCAN')).toBe('index');
    expect(stageTone('Bitmap Index Scan')).toBe('index');
    expect(stageTone('FETCH')).toBe('other');
  });

  it('offers setup only where the instrumentation can explain', () => {
    expect(explainGuidance('autotel-mongoose', 'mongodb')).toMatchObject({
      kind: 'setup',
      code: "instrumentMongoose(mongoose, { explain: 'plan' });",
    });
    expect(
      explainGuidance('autotel-plugins/drizzle', 'postgresql'),
    ).toMatchObject({ kind: 'setup', source: 'autotel-drizzle' });
    // Drizzle on MySQL: the option exists but does nothing.
    expect(explainGuidance('autotel-plugins/drizzle', 'mysql').kind).toBe(
      'unavailable',
    );
    // The official driver plugin cannot explain: the manual path.
    const driver = explainGuidance(
      '@opentelemetry/instrumentation-mongodb',
      'mongodb',
    );
    expect(driver.kind).toBe('manual');
    expect(driver.kind === 'manual' && driver.code).toContain(
      'planFromExplain',
    );
    expect(explainGuidance(undefined, 'mongodb').kind).toBe('manual');
    // Never Mongoose advice for a database Mongoose has nothing to do with.
    for (const [scope, system] of [
      ['@opentelemetry/instrumentation-redis', 'redis'],
      ['@opentelemetry/instrumentation-mysql2', 'mysql'],
      [undefined, 'sqlite'],
      ['@opentelemetry/instrumentation-pg', 'postgresql'],
    ] as const) {
      const guidance = explainGuidance(scope, system);
      expect(guidance.kind).toBe('unavailable');
      expect(JSON.stringify(guidance)).not.toContain('instrumentMongoose');
    }
  });

  it('says why an index was suggested in terms of the numbers shown', () => {
    expect(
      indexReason({
        fullScan: true,
        blockingSort: true,
        rowsExamined: 60_000,
        rowsReturned: 16,
      }),
    ).toBe(
      'This run read the whole collection and sorted the results in memory, examining 60000 to return 16.',
    );
    expect(indexReason({ fullScan: false, blockingSort: true })).toBe(
      'This run sorted the results in memory.',
    );
  });
});
