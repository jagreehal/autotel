import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('falls back to defaults with no flags and no environment', () => {
    const config = loadConfig([], {});
    expect(config.backend).toBe('collector');
    expect(config.transport).toBe('stdio');
    expect(config.port).toBe(3000);
    expect(config.host).toBe('127.0.0.1');
    expect(config.collectorPort).toBe(4318);
  });

  it('reads the environment', () => {
    const config = loadConfig([], {
      AUTOTEL_TRANSPORT: 'http',
      AUTOTEL_PORT: '9001',
      AUTOTEL_COLLECTOR_PORT: '4319',
    });
    expect(config.transport).toBe('http');
    expect(config.port).toBe(9001);
    expect(config.collectorPort).toBe(4319);
  });

  it('lets flags win over the environment', () => {
    const config = loadConfig(['--transport', 'http', '--port', '3000'], {
      AUTOTEL_TRANSPORT: 'stdio',
      AUTOTEL_PORT: '9999',
    });
    expect(config.transport).toBe('http');
    expect(config.port).toBe(3000);
  });

  it('ignores argv unless it is passed in', () => {
    // An embedder's own CLI must not leak into this config.
    expect(loadConfig(undefined, { AUTOTEL_PORT: '4242' }).port).toBe(4242);
  });

  it('throws on bad arguments instead of starting misconfigured', () => {
    expect(() => loadConfig(['--port'], {})).toThrow(/--port requires a value/);
  });

  it('ignores an unknown flag rather than refusing to start', () => {
    expect(loadConfig(['--nope', '--port', '3000'], {}).port).toBe(3000);
  });

  it('rejects a credential passed as a flag', () => {
    expect(() => loadConfig(['--datadog-api-key', 'secret'], {})).toThrow(
      /DD_API_KEY/,
    );
  });

  it('lets the Datadog region come from a flag, beating the environment', () => {
    // A region hostname is not a credential. The flag has to reach the config,
    // not just parse.
    expect(
      loadConfig(['--datadog-site', 'datadoghq.eu'], { DD_SITE: 'datadoghq.com' })
        .datadogSite,
    ).toBe('datadoghq.eu');
    expect(loadConfig([], { DD_SITE: 'datadoghq.com' }).datadogSite).toBe(
      'datadoghq.com',
    );
  });

  it('takes credentials from the environment only', () => {
    const config = loadConfig([], {
      DD_API_KEY: 'from-env',
      SIGNOZ_API_KEY: 'also-env',
      LOGFIRE_READ_TOKEN: 'token',
    });
    expect(config.datadogApiKey).toBe('from-env');
    expect(config.signozApiKey).toBe('also-env');
    expect(config.logfireReadToken).toBe('token');
  });

  it('picks the retention default from whether storage is persistent', () => {
    expect(loadConfig([], {}).retentionMs).toBe(3_600_000);
    expect(loadConfig(['--persist', './a.db'], {}).retentionMs).toBe(86_400_000);
    // An explicit value survives both paths.
    expect(loadConfig(['--persist', './a.db', '--retention-ms', '60000'], {}).retentionMs).toBe(
      60_000,
    );
  });

  it('rejects a transport the server cannot serve', () => {
    expect(() => loadConfig(['--transport', 'carrier-pigeon'], {})).toThrow();
  });
});
