import { describe, expect, it } from 'vitest';
import {
  ignoreUrlPatterns,
  isSelfTelemetryUrl,
  VENDOR_TELEMETRY_URLS,
  normaliseOtlpEndpoint,
  otlpEndpointFor,
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

describe('an endpoint carrying its key as a query', () => {
  // Sentry authenticates browsers with `?sentry_key=`, since sendBeacon cannot
  // carry a header. The signal path must go before the query, not after it.
  const sentry =
    'https://o1.ingest.sentry.io/api/2/integration/otlp?sentry_key=abc';

  it('puts the traces path before the query', () => {
    expect(normaliseOtlpEndpoint(sentry)).toBe(
      'https://o1.ingest.sentry.io/api/2/integration/otlp/v1/traces?sentry_key=abc',
    );
  });

  it('swaps the signal path and keeps the query', () => {
    expect(otlpEndpointFor(sentry, 'logs')).toBe(
      'https://o1.ingest.sentry.io/api/2/integration/otlp/v1/logs?sentry_key=abc',
    );
  });

  it('still excludes the exporter POST from tracing', () => {
    const ignored = selfInstrumentationIgnoreUrls(sentry);
    const url =
      'https://o1.ingest.sentry.io/api/2/integration/otlp/v1/traces?sentry_key=abc';
    expect(ignored.some((pattern) => pattern.test(url))).toBe(true);
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

  describe('given the page origin', () => {
    const PAGE = 'http://localhost:3000';
    const ignores = (endpoint: string | undefined, url: string, page = PAGE) =>
      selfInstrumentationIgnoreUrls(endpoint, page).some((p) => p.test(url));

    // A loopback port says nothing about who owns it: a dev app's own API
    // routinely lives on one, with the OTLP endpoint proxied through it.
    it('traces a local API server that also carries the endpoint', () => {
      const dev = (url: string) =>
        selfInstrumentationIgnoreUrls(
          'http://localhost:3000/otlp',
          'http://localhost:5173',
        ).some((p) => p.test(url));

      expect(dev('http://localhost:3000/otlp/v1/traces')).toBe(true);
      expect(dev('http://localhost:3000/otlp/v1/logs')).toBe(true);
      expect(dev('http://localhost:3000/api/orders')).toBe(false);
    });

    describe('when the app says the collector owns its origin', () => {
      const owned = (endpoint: string, url: string, page = PAGE) =>
        selfInstrumentationIgnoreUrls(endpoint, page, true).some((p) =>
          p.test(url),
        );

      it('ignores the whole of a cross-origin collector', () => {
        // The widget the collector serves polls its own API from this page.
        expect(
          owned(
            'http://localhost:4848',
            'http://localhost:4848/api/query/traces',
          ),
        ).toBe(true);
        expect(
          owned('http://localhost:4848', 'http://localhost:4848/v1/traces'),
        ).toBe(true);
      });

      it('covers both loopback spellings of one collector', () => {
        expect(
          owned(
            'http://localhost:4848',
            'http://127.0.0.1:4848/api/query/errors',
          ),
        ).toBe(true);
        expect(
          owned(
            'http://127.0.0.1:4848',
            'http://localhost:4848/api/query/errors',
          ),
        ).toBe(true);
      });

      it('holds even with no page origin to compare against', () => {
        expect(
          selfInstrumentationIgnoreUrls(
            'http://localhost:4848',
            undefined,
            true,
          ).some((p) => p.test('http://localhost:4848/api/query/traces')),
        ).toBe(true);
      });

      it('ignores a remote collector whole as well', () => {
        expect(
          owned(
            'https://otlp.vendor.io/v1/traces',
            'https://otlp.vendor.io/status',
            'https://app.example.com',
          ),
        ).toBe(true);
      });

      it('never silences the page own origin', () => {
        expect(owned('', 'http://localhost:3000/api/rates')).toBe(false);
        expect(owned('', 'http://localhost:3000/v1/traces')).toBe(true);
      });
    });

    it('does not ignore the collector origin without that declaration', () => {
      expect(
        ignores(
          'http://localhost:4848',
          'http://localhost:4848/api/query/traces',
        ),
      ).toBe(false);
      expect(
        ignores('http://localhost:4848', 'http://localhost:4848/v1/traces'),
      ).toBe(true);
    });

    it('still traces the application', () => {
      expect(
        ignores('http://localhost:4848', 'http://localhost:3000/api/rates'),
      ).toBe(false);
      expect(
        ignores('http://localhost:4848', 'https://api.example.com/orders'),
      ).toBe(false);
    });

    it('does not match a different port on the collector host', () => {
      expect(
        ignores('http://localhost:4848', 'http://localhost:9999/v1/traces'),
      ).toBe(false);
    });

    it('keeps the narrow rule for a same-origin collector', () => {
      // Excluding this origin would silence the application's own API.
      expect(ignores('', 'http://localhost:3000/v1/traces')).toBe(true);
      expect(ignores('', 'http://localhost:3000/api/rates')).toBe(false);
    });

    // A remote collector is not a dev collector: `api.example.com` takes the
    // OTLP export *and* serves the application's own API. Excluding that whole
    // origin silences the requests the page exists to make.
    describe('given a remote collector', () => {
      const APP = 'https://app.example.com';
      const OTLP = 'https://api.example.com/otlp';
      const remote = (url: string) =>
        selfInstrumentationIgnoreUrls(OTLP, APP).some((p) => p.test(url));

      it('ignores the OTLP paths', () => {
        expect(remote('https://api.example.com/otlp/v1/traces')).toBe(true);
        expect(remote('https://api.example.com/otlp/v1/logs')).toBe(true);
      });

      it('still traces the API beside them', () => {
        expect(remote('https://api.example.com/orders')).toBe(false);
        expect(remote('https://api.example.com/otlp/status')).toBe(false);
      });

      it('ignores a vendor collector by its path all the same', () => {
        const vendor = (url: string) =>
          selfInstrumentationIgnoreUrls(
            'https://otlp.vendor.io/v1/traces',
            APP,
          ).some((p) => p.test(url));
        expect(vendor('https://otlp.vendor.io/v1/traces')).toBe(true);
        expect(vendor('https://otlp.vendor.io/v1/logs')).toBe(true);
        expect(vendor('https://otlp.vendor.io/status')).toBe(false);
      });
    });
  });
});

describe('isSelfTelemetryUrl', () => {
  const PAGE = 'http://localhost:3000';
  const isSelf = (url: string, endpoint?: string, page = PAGE) =>
    isSelfTelemetryUrl(url, endpoint, page);

  describe('when the app says the collector owns its origin', () => {
    const owned = (url: string, endpoint?: string, page = PAGE) =>
      isSelfTelemetryUrl(url, endpoint, page, true);

    it('ignores the whole collector origin, not just the OTLP path', () => {
      expect(
        owned('http://localhost:4848/v1/traces', 'http://localhost:4848'),
      ).toBe(true);
      // The devtools UI and query API sit beside /v1/traces on that origin.
      expect(
        owned(
          'http://localhost:4848/api/query/traces',
          'http://localhost:4848',
        ),
      ).toBe(true);
      expect(
        owned('http://localhost:4848/widget.js', 'http://localhost:4848'),
      ).toBe(true);
    });

    it('treats the loopback aliases as one collector', () => {
      // One collector named `localhost` in .env and `127.0.0.1` in the widget.
      expect(
        owned(
          'http://127.0.0.1:4848/api/query/traces',
          'http://localhost:4848',
        ),
      ).toBe(true);
      expect(
        owned(
          'http://localhost:4848/api/query/errors',
          'http://127.0.0.1:4848',
        ),
      ).toBe(true);
    });

    it('still keeps the page own origin instrumented', () => {
      // Whatever the app declares, this one cannot be honoured: it would
      // silence the application itself.
      expect(owned('http://localhost:3000/api/rates', '')).toBe(false);
      expect(owned('http://localhost:3000/v1/traces', '')).toBe(true);
    });
  });

  it('keeps a local API server instrumented by default', () => {
    // Vite on 5173, the app's API on 3000, OTLP proxied through it.
    const page = 'http://localhost:5173';
    const otlp = 'http://localhost:3000/otlp';
    expect(isSelf(`${otlp}/v1/traces`, otlp, page)).toBe(true);
    expect(isSelf(`${otlp}/v1/logs`, otlp, page)).toBe(true);
    expect(isSelf('http://localhost:3000/api/orders', otlp, page)).toBe(false);
  });

  it('does not ignore the collector origin without that declaration', () => {
    expect(
      isSelf('http://localhost:4848/api/query/traces', 'http://localhost:4848'),
    ).toBe(false);
    expect(
      isSelf('http://localhost:4848/v1/traces', 'http://localhost:4848'),
    ).toBe(true);
  });

  it('leaves the application alone', () => {
    expect(
      isSelf('http://localhost:3000/api/rates', 'http://localhost:4848'),
    ).toBe(false);
    expect(isSelf('/api/rates', 'http://localhost:4848')).toBe(false);
    expect(
      isSelf('https://api.example.com/v1/charge', 'http://localhost:4848'),
    ).toBe(false);
  });

  it('does not confuse a different port on the same host', () => {
    expect(
      isSelf('http://localhost:9999/v1/traces', 'http://localhost:4848'),
    ).toBe(false);
  });

  it('ignores only the OTLP paths when the collector shares the page origin', () => {
    // Excluding the whole origin here would silence the app's own API.
    expect(isSelf('http://localhost:3000/v1/traces', '')).toBe(true);
    expect(isSelf('http://localhost:3000/v1/logs', '')).toBe(true);
    expect(isSelf('http://localhost:3000/api/rates', '')).toBe(false);
  });

  it('instruments everything when no endpoint is configured', () => {
    expect(isSelf('http://localhost:4848/v1/traces', undefined)).toBe(false);
  });

  it('does not throw on an unparseable url', () => {
    expect(isSelf('::::', 'http://localhost:4848')).toBe(false);
  });

  describe('a remote collector sharing an origin with the app API', () => {
    const APP = 'https://app.example.com';
    const OTLP = 'https://api.example.com/otlp';

    it('ignores the OTLP paths', () => {
      expect(isSelf(`${OTLP}/v1/traces`, OTLP, APP)).toBe(true);
      expect(isSelf(`${OTLP}/v1/logs`, OTLP, APP)).toBe(true);
    });

    it('leaves the rest of that origin instrumented', () => {
      // The whole point of the page: these must keep their span and their
      // traceparent.
      expect(isSelf('https://api.example.com/orders', OTLP, APP)).toBe(false);
      expect(isSelf('https://api.example.com/otlp/status', OTLP, APP)).toBe(
        false,
      );
    });
  });
});

describe('other telemetry vendors', () => {
  const vendor = (url: string) =>
    VENDOR_TELEMETRY_URLS.some((pattern) => pattern.test(url));

  it('never traces their uploads', () => {
    expect(
      vendor('https://browser-intake-datadoghq.eu/api/v2/rum?ddsource=browser'),
    ).toBe(true);
    expect(vendor('https://browser-intake-us3-datadoghq.com/api/v2/logs')).toBe(
      true,
    );
    expect(
      vendor('https://o1.ingest.us.sentry.io/api/2/envelope/?sentry_key=k'),
    ).toBe(true);
    expect(vendor('https://o1.ingest.sentry.io/api/2/envelope/')).toBe(true);
    expect(vendor('https://eu.i.posthog.com/e/?ip=1')).toBe(true);
    expect(vendor('https://bam.nr-data.net/1/key')).toBe(true);
  });

  it('leaves look-alikes and the app alone', () => {
    expect(vendor('https://api.example.com/browser-intake-x/orders')).toBe(
      false,
    );
    expect(vendor('https://ingest.sentry.io.attacker.example/x')).toBe(false);
    expect(vendor('https://posthog.com/pricing')).toBe(false);
    expect(vendor('http://localhost:5173/api/orders')).toBe(false);
  });
});

describe('ignoreUrlPatterns', () => {
  it('treats a string as a URL prefix on the page', () => {
    const [pattern] = ignoreUrlPatterns(
      ['/rum-proxy'],
      'https://app.example.com',
    );
    expect(pattern!.test('https://app.example.com/rum-proxy?ddforward=x')).toBe(
      true,
    );
    expect(pattern!.test('https://app.example.com/api/rum-proxy')).toBe(false);
  });

  it('matches the same URL every time, whatever flags the RegExp has', () => {
    // A /g or /y RegExp keeps lastIndex between .test() calls, so the same
    // URL alternated match / no match and an ignored request got through
    // every other time.
    const caller = /rum-proxy/g;
    const [pattern] = ignoreUrlPatterns([caller], undefined);
    const url = 'https://app.example.com/rum-proxy?ddforward=x';
    expect([1, 2, 3, 4].map(() => pattern!.test(url))).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(caller.lastIndex).toBe(0);
    expect(caller.flags).toBe('g');
  });

  it('uses a RegExp as given', () => {
    const [pattern] = ignoreUrlPatterns([/\/health$/], undefined);
    expect(pattern!.test('https://app.example.com/health')).toBe(true);
  });
});
