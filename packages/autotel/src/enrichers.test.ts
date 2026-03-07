import { describe, expect, it } from 'vitest';
import { userAgent, geo, requestSize } from './enrichers';

describe('enrichers', () => {
  describe('userAgent', () => {
    it('parses Chrome on macOS', () => {
      const result = userAgent({
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });

      expect(result).toMatchObject({
        'user_agent.browser': 'Chrome 120.0.0.0',
        'user_agent.os': 'macOS 10.15.7',
        'user_agent.device': 'desktop',
      });
      expect(result?.['user_agent.raw']).toBeDefined();
    });

    it('parses Firefox on Windows', () => {
      const result = userAgent({
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
      });

      expect(result).toMatchObject({
        'user_agent.browser': 'Firefox 121.0',
        'user_agent.os': 'Windows 10.0',
        'user_agent.device': 'desktop',
      });
    });

    it('detects mobile device', () => {
      const result = userAgent({
        'user-agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
      });

      expect(result?.['user_agent.device']).toBe('mobile');
      expect(result?.['user_agent.os']).toBe('iOS 17.2');
    });

    it('detects bot', () => {
      const result = userAgent({
        'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)',
      });

      expect(result?.['user_agent.device']).toBe('bot');
    });

    it('returns undefined when no user-agent header', () => {
      expect(userAgent({})).toBeUndefined();
    });

    it('accepts mixed-case User-Agent header names', () => {
      const result = userAgent({
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
      });

      expect(result).toMatchObject({
        'user_agent.browser': 'Firefox 121.0',
        'user_agent.os': 'Windows 10.0',
      });
    });
  });

  describe('geo', () => {
    it('extracts Vercel geo headers', () => {
      const result = geo({
        'x-vercel-ip-country': 'US',
        'x-vercel-ip-country-region': 'CA',
        'x-vercel-ip-city': 'San%20Francisco',
        'x-vercel-ip-latitude': '37.7749',
        'x-vercel-ip-longitude': '-122.4194',
      });

      expect(result).toEqual({
        'geo.country': 'US',
        'geo.region': 'CA',
        'geo.city': 'San Francisco',
        'geo.latitude': '37.7749',
        'geo.longitude': '-122.4194',
      });
    });

    it('extracts Cloudflare country header', () => {
      const result = geo({ 'cf-ipcountry': 'GB' });

      expect(result).toEqual({ 'geo.country': 'GB' });
    });

    it('does not throw on malformed encoded city values', () => {
      expect(() =>
        geo({
          'x-vercel-ip-country': 'US',
          'x-vercel-ip-city': '%E0%A4%A',
        }),
      ).not.toThrow();
    });

    it('returns undefined when no geo headers', () => {
      expect(geo({})).toBeUndefined();
    });

    it('returns longitude when it is the only geo signal', () => {
      const result = geo({ 'x-vercel-ip-longitude': '-0.1276' });

      expect(result).toEqual({ 'geo.longitude': '-0.1276' });
    });
  });

  describe('requestSize', () => {
    it('extracts request and response sizes', () => {
      const result = requestSize(
        { 'content-length': '1024' },
        { 'content-length': '2048' },
      );

      expect(result).toEqual({
        'http.request.body.size': 1024,
        'http.response.body.size': 2048,
      });
    });

    it('handles request-only size', () => {
      const result = requestSize({ 'content-length': '512' });

      expect(result).toEqual({ 'http.request.body.size': 512 });
    });

    it('returns undefined when no content-length headers', () => {
      expect(requestSize({}, {})).toBeUndefined();
    });

    it('ignores non-numeric content-length', () => {
      expect(requestSize({ 'content-length': 'abc' })).toBeUndefined();
    });

    it('ignores invalid numeric content-length values', () => {
      expect(requestSize({ 'content-length': '-1' })).toBeUndefined();
      expect(requestSize({ 'content-length': '12.5' })).toBeUndefined();
    });

    it('ignores non-digit numeric formats for content-length', () => {
      expect(requestSize({ 'content-length': '1e3' })).toBeUndefined();
      expect(requestSize({ 'content-length': '+10' })).toBeUndefined();
    });
  });
});
