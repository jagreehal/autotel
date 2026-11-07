import type { Span } from '@opentelemetry/api';
import {
  TracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace';
import { describe, expect, it } from 'vitest';
import { withHttpClientUrlTemplate } from './http-client-url-template';

const HTTP = '@opentelemetry/instrumentation-http';
const UNDICI = '@opentelemetry/instrumentation-undici';

const exporter = new InMemorySpanExporter();
const tracer = new TracerProvider({
  spanProcessors: [new SimpleSpanProcessor({ exporter })],
}).getTracer('test');

const template = (url: URL) =>
  url.pathname.startsWith('/orders/') ? '/orders/{id}' : undefined;

/** The request fields either instrumentation hands its hook. */
interface HookRequest {
  method: string;
  path?: string;
  url?: string;
  protocol?: string;
  host?: string;
  origin?: string;
  getHeader?: (name: string) => string | undefined;
}

type Hook = (span: Span, request: HookRequest) => void;

/** Run `hook` on a fresh client span named as the instrumentation names it. */
function finished(hook: Hook, request: HookRequest) {
  exporter.reset();
  const span = tracer.startSpan('GET');
  hook(span, request);
  span.end();
  return exporter.getFinishedSpans()[0]!;
}

function hookFor(name: string, config = {}): Hook {
  // SAFETY: withHttpClientUrlTemplate sets requestHook on both entries.
  return withHttpClientUrlTemplate(config, template)[name]!.requestHook as Hook;
}

const clientRequest = (
  path: string,
  host = 'api.example.com',
  hostHeader: string | null = host,
) => ({
  method: 'GET',
  protocol: 'https:',
  host,
  path,
  getHeader: (name: string) =>
    name === 'host' ? (hostHeader ?? undefined) : undefined,
});

describe('withHttpClientUrlTemplate', () => {
  it('names an http client span after the template', () => {
    const span = finished(hookFor(HTTP), clientRequest('/orders/ord_1?x=1'));

    expect(span.name).toBe('GET /orders/{id}');
    expect(span.attributes['url.template']).toBe('/orders/{id}');
  });

  it('names a fetch (undici) client span after the template', () => {
    const span = finished(hookFor(UNDICI), {
      origin: 'https://api.example.com',
      method: 'POST',
      path: '/orders/ord_2',
    });

    expect(span.name).toBe('POST /orders/{id}');
  });

  it('hands the mapper the port and an IPv6 host', () => {
    const seen: string[] = [];
    // SAFETY: withHttpClientUrlTemplate sets requestHook on both entries.
    const hook = withHttpClientUrlTemplate({}, (url) => {
      seen.push(url.host);
      return template(url);
    })[HTTP]!.requestHook as Hook;

    finished(
      hook,
      clientRequest('/a', 'api.example.com', 'api.example.com:8443'),
    );
    finished(hook, clientRequest('/a', '::1', '[::1]:3000'));
    // Sent with `setHost: false`: no header, so the hostname alone.
    finished(hook, clientRequest('/a', '::1', null));

    expect(seen).toEqual(['api.example.com:8443', '[::1]:3000', '[::1]']);
  });

  it("still runs the caller's hook when the URL cannot be read", () => {
    const hook = hookFor(HTTP, {
      [HTTP]: { requestHook: (span: Span) => span.updateName('mine') },
    });

    const span = finished(hook, clientRequest('/a', 'bad host', 'bad host'));

    expect(span.name).toBe('mine');
  });

  it('keeps the name when the template returns nothing', () => {
    const span = finished(hookFor(HTTP), clientRequest('/health'));

    expect(span.name).toBe('GET');
    expect(span.attributes['url.template']).toBeUndefined();
  });

  it('leaves a server request alone', () => {
    const span = finished(hookFor(HTTP), { method: 'GET', url: '/orders/1' });

    expect(span.name).toBe('GET');
  });

  it("runs the caller's requestHook after its own, so the caller wins", () => {
    const hook = hookFor(HTTP, {
      [HTTP]: { requestHook: (span: Span) => span.updateName('mine') },
    });

    expect(finished(hook, clientRequest('/orders/ord_1')).name).toBe('mine');
  });

  it('returns the config unchanged with no template', () => {
    const config = { [HTTP]: { enabled: true } };

    expect(withHttpClientUrlTemplate(config, undefined)).toBe(config);
  });
});
