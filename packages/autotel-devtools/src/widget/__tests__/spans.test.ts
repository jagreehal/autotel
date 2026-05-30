import { describe, it, expect } from 'vitest';
import { spanKindLabel, statusLabel } from '../utils/spans';

describe('spanKindLabel', () => {
  it('returns UNSPECIFIED for 0', () => {
    expect(spanKindLabel(0)).toBe('UNSPECIFIED');
  });

  it('returns INTERNAL for 1', () => {
    expect(spanKindLabel(1)).toBe('INTERNAL');
  });

  it('returns SERVER for 2', () => {
    expect(spanKindLabel(2)).toBe('SERVER');
  });

  it('returns CLIENT for 3', () => {
    expect(spanKindLabel(3)).toBe('CLIENT');
  });

  it('returns PRODUCER for 4', () => {
    expect(spanKindLabel(4)).toBe('PRODUCER');
  });

  it('returns CONSUMER for 5', () => {
    expect(spanKindLabel(5)).toBe('CONSUMER');
  });

  it('returns UNKNOWN for invalid values', () => {
    expect(spanKindLabel(-1)).toBe('UNKNOWN');
    expect(spanKindLabel(99)).toBe('UNKNOWN');
  });
});

describe('statusLabel', () => {
  it('returns UNSET for 0', () => {
    expect(statusLabel(0)).toBe('UNSET');
  });

  it('returns OK for 1', () => {
    expect(statusLabel(1)).toBe('OK');
  });

  it('returns ERROR for 2', () => {
    expect(statusLabel(2)).toBe('ERROR');
  });

  it('returns UNKNOWN for invalid values', () => {
    expect(statusLabel(-1)).toBe('UNKNOWN');
    expect(statusLabel(99)).toBe('UNKNOWN');
  });
});
