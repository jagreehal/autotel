import { describe, expect, it } from 'vitest';
import {
  normalizeTags,
  normalizeTagValue,
  spanKindTag,
} from '../src/backends/span-mapping';

describe('spanKindTag', () => {
  it('reads the OTLP enum number, the OTLP JSON name and a plain name', () => {
    expect(spanKindTag(2)).toEqual({ 'span.kind': 'server' });
    expect(spanKindTag('SPAN_KIND_CLIENT')).toEqual({ 'span.kind': 'client' });
    expect(spanKindTag('PRODUCER')).toEqual({ 'span.kind': 'producer' });
    expect(spanKindTag(5)).toEqual({ 'span.kind': 'consumer' });
    expect(spanKindTag(1)).toEqual({ 'span.kind': 'internal' });
  });

  it('adds nothing for an unspecified or unknown kind', () => {
    expect(spanKindTag(0)).toEqual({});
    expect(spanKindTag('SPAN_KIND_UNSPECIFIED')).toEqual({});
    expect(spanKindTag(undefined)).toEqual({});
    expect(spanKindTag(9)).toEqual({});
  });
});

describe('normalizeTags', () => {
  it('flattens nested objects to dotted keys and sends arrays as JSON', () => {
    expect(
      normalizeTags({ bound: { id: 2, deep: { ok: true } }, list: ['a', 'b'] }),
    ).toEqual({ 'bound.id': 2, 'bound.deep.ok': true, list: '["a","b"]' });
  });

  it('keeps the text of a value JSON cannot carry', () => {
    expect(normalizeTagValue(Number.NaN)).toBe('NaN');
    expect(normalizeTagValue(10n)).toBe('10');
    expect(normalizeTagValue([10n])).toBe('10');
  });
});
