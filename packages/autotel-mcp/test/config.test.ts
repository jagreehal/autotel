import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig } from '../src/config';

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

// Both guards compare the *hostname* they parse out of the incoming `Host` /
// `Origin` header, so a configured entry carrying a scheme or a port can never
// match one. Left to itself that fails at request time as a 403 with nothing
// to point at; rejecting it at startup says which entry is wrong and why.
describe('allowed hosts and origins', () => {
  beforeEach(() => {
    delete process.env.AUTOTEL_ALLOWED_HOSTS;
    delete process.env.AUTOTEL_ALLOWED_ORIGINS;
  });

  it('accepts bare hostnames', () => {
    process.env.AUTOTEL_ALLOWED_ORIGINS = 'app.example.com, localhost';
    expect(loadConfig().allowedOrigins).toEqual([
      'app.example.com',
      'localhost',
    ]);
  });

  it('rejects an origin written with a scheme', () => {
    process.env.AUTOTEL_ALLOWED_ORIGINS = 'https://app.example.com';
    expect(() => loadConfig()).toThrow(/https:\/\/app\.example\.com/);
    expect(() => loadConfig()).toThrow(/hostname/i);
  });

  it('rejects a host written with a port', () => {
    process.env.AUTOTEL_ALLOWED_HOSTS = 'app.example.com:8080';
    expect(() => loadConfig()).toThrow(/port/i);
  });

  it('lowercases entries, because the header they are compared to is', () => {
    // Both guards parse the hostname out of the header, and URL parsing
    // lowercases it. An entry left capitalised would match no request at all.
    process.env.AUTOTEL_ALLOWED_ORIGINS = 'App.Example.COM';
    expect(loadConfig().allowedOrigins).toEqual(['app.example.com']);
  });

  it('keeps IPv6 loopback, which is a hostname despite the brackets', () => {
    process.env.AUTOTEL_ALLOWED_ORIGINS = '[::1]';
    expect(loadConfig().allowedOrigins).toEqual(['[::1]']);
  });
});

// A config error is something the operator has to act on, so it reads as a
// sentence naming the setting. The raw ZodError buries that in JSON.
describe('configuration errors', () => {
  beforeEach(() => {
    delete process.env.AUTOTEL_ALLOWED_ORIGINS;
    delete process.env.AUTOTEL_BACKEND;
  });

  it('names the setting and what is wrong with it', () => {
    process.env.AUTOTEL_ALLOWED_ORIGINS = 'https://app.example.com';
    expect(() => loadConfig()).toThrow(/invalid configuration/);
    expect(() => loadConfig()).toThrow(/allowedOrigins/);
    expect(() => loadConfig()).toThrow(/remove the scheme/);
    // Not a JSON dump.
    expect(() => loadConfig()).not.toThrow(/"code":/);
  });

  it('reads the same way for a bad enum', () => {
    process.env.AUTOTEL_BACKEND = 'nonsense';
    expect(() => loadConfig()).toThrow(/invalid configuration/);
    expect(() => loadConfig()).toThrow(/backend/);
    expect(() => loadConfig()).not.toThrow(/"expected":/);
  });
});
