import { SpanKind, type Attributes } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import { describe, expect, it } from 'vitest';
import { datadogNames } from './names';

/** The attributes a span left with, after `datadogNames()` saw it end. */
function ended(name: string, kind: SpanKind, attributes: Attributes) {
  const exporter = new InMemorySpanExporter();
  const provider = new TracerProvider({
    spanProcessors: [datadogNames(), new SimpleSpanProcessor({ exporter })],
  });
  provider.getTracer('t').startSpan(name, { kind, attributes }).end();
  return exporter.getFinishedSpans()[0]!.attributes;
}

describe('datadogNames', () => {
  it('names an outbound call by method and host', () => {
    const attributes = ended('POST', SpanKind.CLIENT, {
      'http.request.method': 'POST',
      'server.address': 'api.stripe.com',
    });

    expect(attributes['resource.name']).toBe('POST api.stripe.com');
  });

  it('prefers the url.template when the call has one', () => {
    const attributes = ended('GET /v1/customers/:id', SpanKind.CLIENT, {
      'http.request.method': 'GET',
      'server.address': 'api.stripe.com',
      'url.template': '/v1/customers/:id',
    });

    expect(attributes['resource.name']).toBe('GET /v1/customers/:id');
  });

  it('names an MCP request by method and tool', () => {
    const attributes = ended('mcp.request', SpanKind.SERVER, {
      'mcp.method.name': 'tools/call',
      'gen_ai.tool.name': 'get_contract',
    });

    expect(attributes['resource.name']).toBe('tools/call get_contract');
  });

  it('names an MCP request without a target by its method', () => {
    const attributes = ended('mcp.request', SpanKind.SERVER, {
      'mcp.method.name': 'tools/list',
    });

    expect(attributes['resource.name']).toBe('tools/list');
  });

  it('gives an internal span its own name as the operation', () => {
    const attributes = ended('documentLoad', SpanKind.INTERNAL, {});

    expect(attributes['operation.name']).toBe('documentLoad');
  });

  it('keeps names the span already has', () => {
    const attributes = ended('user.create', SpanKind.INTERNAL, {
      'operation.name': 'user.create.v2',
      'resource.name': 'custom',
      'mcp.method.name': 'tools/list',
    });

    expect(attributes['operation.name']).toBe('user.create.v2');
    expect(attributes['resource.name']).toBe('custom');
  });

  it('leaves server spans to Datadog, which reads http.route', () => {
    const attributes = ended('GET /users/:id', SpanKind.SERVER, {
      'http.request.method': 'GET',
      'http.route': '/users/:id',
    });

    expect(attributes['resource.name']).toBeUndefined();
    expect(attributes['operation.name']).toBeUndefined();
  });
});
