import { describe, expect, it } from 'vitest';
import {
  normaliseOtlpEndpoint,
  selfInstrumentationIgnoreUrls,
} from './otlp-endpoint';

describe('normaliseOtlpEndpoint', () => {
  it('appends the traces path when it is missing', () => {
    expect(normaliseOtlpEndpoint('http://localhost:4318')).toBe(
      'http://localhost:4318/v1/traces',
    );
  });

  it('leaves an endpoint that already has the path alone', () => {
    expect(normaliseOtlpEndpoint('http://localhost:4318/v1/traces')).toBe(
      'http://localhost:4318/v1/traces',
    );
  });

  it('tolerates a trailing slash', () => {
    expect(normaliseOtlpEndpoint('http://localhost:4318/')).toBe(
      'http://localhost:4318/v1/traces',
    );
    expect(normaliseOtlpEndpoint('http://localhost:4318/v1/traces/')).toBe(
      'http://localhost:4318/v1/traces',
    );
  });

  it('keeps a collector mounted under a path prefix', () => {
    expect(normaliseOtlpEndpoint('https://example.com/otel')).toBe(
      'https://example.com/otel/v1/traces',
    );
  });

  it('supports same-origin export via an empty string', () => {
    expect(normaliseOtlpEndpoint('')).toBe('/v1/traces');
  });
});

describe('selfInstrumentationIgnoreUrls', () => {
  const ignores = (endpoint: string | undefined, url: string) =>
    selfInstrumentationIgnoreUrls(endpoint).some((p) => p.test(url));

  it('ignores the collector the exporter posts to', () => {
    expect(
      ignores('http://localhost:4318', 'http://localhost:4318/v1/traces'),
    ).toBe(true);
  });

  it('ignores it when the endpoint already carries the traces path', () => {
    expect(
      ignores(
        'http://localhost:4318/v1/traces',
        'http://localhost:4318/v1/traces',
      ),
    ).toBe(true);
  });

  it('still traces ordinary application requests', () => {
    expect(
      ignores('http://localhost:4318', 'https://api.example.com/orders'),
    ).toBe(false);
  });

  it('does not treat regex characters in the endpoint as a pattern', () => {
    expect(
      ignores('http://localhost:4318', 'http://localhostX4318/v1/traces'),
    ).toBe(false);
  });

  it('returns nothing when no endpoint is configured', () => {
    expect(selfInstrumentationIgnoreUrls(undefined)).toEqual([]);
  });
});
