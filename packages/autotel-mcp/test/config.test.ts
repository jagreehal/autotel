import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  beforeEach(() => {
    delete process.env.AUTOTEL_BACKEND;
    delete process.env.AUTOTEL_TRANSPORT;
    delete process.env.AUTOTEL_PORT;
    delete process.env.AUTOTEL_HOST;
    delete process.env.AUTOTEL_COLLECTOR_PORT;
    delete process.env.AUTOTEL_PERSIST;
    delete process.env.AUTOTEL_RETENTION_MS;
    delete process.env.AUTOTEL_MAX_TRACES;
    delete process.env.JAEGER_BASE_URL;
  });

  it('returns defaults when no env set', () => {
    const config = loadConfig();
    expect(config.backend).toBe('collector');
    expect(config.transport).toBe('stdio');
    expect(config.port).toBe(3000);
    expect(config.host).toBe('127.0.0.1');
    expect(config.collectorPort).toBe(4318);
    expect(config.persist).toBeUndefined();
    expect(config.retentionMs).toBe(3_600_000);
    expect(config.maxTraces).toBe(10_000);
    expect(config.jaegerBaseUrl).toBe('http://localhost:16686');
  });

  it('reads env overrides', () => {
    process.env.AUTOTEL_BACKEND = 'jaeger';
    process.env.AUTOTEL_TRANSPORT = 'http';
    process.env.AUTOTEL_PORT = '8080';
    process.env.AUTOTEL_COLLECTOR_PORT = '4319';
    process.env.AUTOTEL_PERSIST = './data.db';
    process.env.AUTOTEL_MAX_TRACES = '5000';
    process.env.JAEGER_BASE_URL = 'http://jaeger:16686';

    const config = loadConfig();
    expect(config.backend).toBe('jaeger');
    expect(config.transport).toBe('http');
    expect(config.port).toBe(8080);
    expect(config.collectorPort).toBe(4319);
    expect(config.persist).toBe('./data.db');
    expect(config.maxTraces).toBe(5000);
    expect(config.jaegerBaseUrl).toBe('http://jaeger:16686');
  });

  it('uses 24h retention when persist is set', () => {
    process.env.AUTOTEL_PERSIST = './data.db';
    const config = loadConfig();
    expect(config.retentionMs).toBe(86_400_000);
  });
});
