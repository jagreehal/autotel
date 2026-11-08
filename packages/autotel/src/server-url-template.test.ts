import { describe, expect, it } from 'vitest';
import type { Span } from '@opentelemetry/api';
import {
  nameUnroutedServerSpan,
  serverUrlTemplate,
  withUnroutedServerNames,
} from './server-url-template';

function fakeSpan(attributes: Record<string, unknown> = {}) {
  const span = {
    name: 'GET',
    attributes,
    setAttribute(key: string, value: unknown) {
      attributes[key] = value;
      return span;
    },
    updateName(name: string) {
      span.name = name;
      return span;
    },
  };
  return span;
}

const response = (statusCode: number) => ({ statusCode, writeHead() {} });
const OID = '67100478766128ccd2b8ee31';

describe('serverUrlTemplate', () => {
  it('replaces id segments and drops the query', () => {
    expect(serverUrlTemplate(`/users/${OID}/x/42?a=1`)).toBe(
      '/users/:id/x/:id',
    );
  });
});

describe('nameUnroutedServerSpan', () => {
  it('names a server span that ended without a route', () => {
    const span = fakeSpan();
    nameUnroutedServerSpan(
      span as unknown as Span,
      { method: 'GET', url: `/users/${OID}/x` },
      response(401),
    );
    expect(span.name).toBe('GET /users/:id/x');
    expect(span.attributes['url.template']).toBe('/users/:id/x');
    expect(span.attributes['http.route']).toBeUndefined();
  });

  it('leaves a matched route, a success, a 404 and a client span alone', () => {
    const ok = fakeSpan();
    nameUnroutedServerSpan(
      ok as unknown as Span,
      { method: 'GET', url: '/blog/my-post' },
      response(200),
    );
    expect(ok.name).toBe('GET');
    const routed = fakeSpan({ 'http.route': '/users/:id' });
    nameUnroutedServerSpan(
      routed as unknown as Span,
      { method: 'GET', url: `/users/${OID}` },
      response(401),
    );
    const missing = fakeSpan();
    nameUnroutedServerSpan(
      missing as unknown as Span,
      { method: 'GET', url: '/wp-admin/x.php' },
      response(404),
    );
    const client = fakeSpan();
    nameUnroutedServerSpan(
      client as unknown as Span,
      { method: 'GET', url: '/x' },
      { statusCode: 200 },
    );
    expect([routed.name, missing.name, client.name]).toEqual([
      'GET',
      'GET',
      'GET',
    ]);
  });
});

describe('withUnroutedServerNames', () => {
  it('runs the caller hook after its own, and wraps only once', () => {
    const calls: string[] = [];
    const config = withUnroutedServerNames({
      '@opentelemetry/instrumentation-http': {
        applyCustomAttributesOnSpan: () => calls.push('caller'),
      },
    });
    expect(withUnroutedServerNames(config)).toBe(config);
    const hook = config['@opentelemetry/instrumentation-http']
      ?.applyCustomAttributesOnSpan as (...args: unknown[]) => void;
    const span = fakeSpan();
    hook(span, { method: 'POST', url: '/a/1' }, response(401));
    expect(span.name).toBe('POST /a/:id');
    expect(calls).toEqual(['caller']);
  });

  it('adds nothing when http is disabled', () => {
    const config = {
      '@opentelemetry/instrumentation-http': { enabled: false },
    };
    expect(withUnroutedServerNames(config)).toBe(config);
  });
});
