import { describe, it, expect } from 'vitest';
import { packEventLanes, classifyEvent } from '../utils/spanEvents';

type Ev = { name: string; timestamp: number; attributes?: Record<string, unknown> };

describe('packEventLanes', () => {
  it('places a single event in one lane at its relative position', () => {
    const events: Ev[] = [{ name: 'cache_hit', timestamp: 150 }];
    // trace spans [100, 200] => duration 100; event at 150 => 50%.
    const lanes = packEventLanes(events, 100, 100);
    expect(lanes).toHaveLength(1);
    expect(lanes[0]).toHaveLength(1);
    expect(lanes[0][0].index).toBe(0);
    expect(lanes[0][0].posPercent).toBe(50);
  });

  it('returns no lanes for an empty event list', () => {
    expect(packEventLanes([], 100, 100)).toEqual([]);
  });

  it('keeps well-separated events in the same lane', () => {
    const events: Ev[] = [
      { name: 'a', timestamp: 110 }, // 10%
      { name: 'b', timestamp: 190 }, // 90%
    ];
    const lanes = packEventLanes(events, 100, 100);
    expect(lanes).toHaveLength(1);
    expect(lanes[0].map((e) => e.index)).toEqual([0, 1]);
  });

  it('pushes events closer than 2% into separate lanes to avoid overlap', () => {
    const events: Ev[] = [
      { name: 'a', timestamp: 150 }, // 50%
      { name: 'b', timestamp: 151 }, // 51% -> within 2% of a
    ];
    const lanes = packEventLanes(events, 100, 100);
    expect(lanes).toHaveLength(2);
    expect(lanes[0][0].index).toBe(0);
    expect(lanes[1][0].index).toBe(1);
  });

  it('clamps positions to the 0–100 range', () => {
    const events: Ev[] = [
      { name: 'before', timestamp: 50 }, // before trace start
      { name: 'after', timestamp: 500 }, // after trace end
    ];
    const lanes = packEventLanes(events, 100, 100);
    const all = lanes.flat();
    expect(all.find((e) => e.index === 0)!.posPercent).toBe(0);
    expect(all.find((e) => e.index === 1)!.posPercent).toBe(100);
  });
});

describe('classifyEvent', () => {
  it('classifies an OTel exception event as an exception', () => {
    expect(classifyEvent({ name: 'exception', timestamp: 1 })).toBe('exception');
  });

  it('classifies an error-severity event as an exception', () => {
    expect(
      classifyEvent({ name: 'log', timestamp: 1, attributes: { level: 'error' } }),
    ).toBe('exception');
  });

  it('treats other events as plain events', () => {
    expect(classifyEvent({ name: 'cache_hit', timestamp: 1 })).toBe('event');
  });
});
