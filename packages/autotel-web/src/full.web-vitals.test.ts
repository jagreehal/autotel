// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initFull, resetFullForTesting } from './full';
import { resetForTesting } from './span-exporter';
import { resetSessionForTesting } from './session';
import { captureEvents, eventsNamed } from './test-events';

import type { WebVitalReport } from './web-vitals';

type Report = (metric: WebVitalReport) => void;
interface ReportOpts {
  reportAllChanges?: boolean;
  reportSoftNavs?: boolean;
}
interface Registration {
  name: string;
  report: Report;
  opts: ReportOpts;
}
const registered = vi.hoisted((): Registration[] => []);

vi.mock('web-vitals/attribution', () => {
  const on = (name: string) => (report: Report, opts: ReportOpts) =>
    registered.push({ name, report, opts });
  return {
    onCLS: on('CLS'),
    onINP: on('INP'),
    onLCP: on('LCP'),
    onFCP: on('FCP'),
    onTTFB: on('TTFB'),
  };
});

beforeEach(() => {
  registered.length = 0;
  resetFullForTesting();
  resetForTesting();
  resetSessionForTesting();
});

afterEach(() => {
  resetFullForTesting();
  resetForTesting();
  resetSessionForTesting();
});

it('registers every vital from the attribution build with the configured options', async () => {
  initFull({
    service: 'web',
    webVitals: { reportAllChanges: true, reportSoftNavs: true },
  });
  await vi.waitFor(() => expect(registered).toHaveLength(5));
  expect(registered.map((r) => r.name)).toEqual(
    expect.arrayContaining(['CLS', 'FCP', 'INP', 'LCP', 'TTFB']),
  );
  for (const { opts } of registered) {
    expect(opts).toEqual({ reportAllChanges: true, reportSoftNavs: true });
  }
});

it('forwards attributeRedactor from initFull to attribution selectors and URLs', async () => {
  initFull({
    service: 'web',
    attributeRedactor: {
      valuePatterns: [
        { name: 'user', pattern: /user-\d+/g, replacement: '[ID]' },
      ],
    },
  });
  await vi.waitFor(() => expect(registered).toHaveLength(5));
  captureEvents();

  const lcp = registered.find((r) => r.name === 'LCP')!;
  lcp.report({
    name: 'LCP',
    value: 3000,
    rating: 'poor',
    navigationId: 2,
    navigationURL: 'https://shop.example.com/u/user-77?x=1',
    attribution: {
      target: 'img#user-4821',
      url: 'https://cdn.example.com/user-4821.png',
    },
  });

  const [event] = eventsNamed('browser.web_vital');
  expect(event.attributes).toMatchObject({
    'browser.web_vital.target': 'img#[ID]',
    'browser.web_vital.resource_url': 'https://cdn.example.com/[ID].png',
    'browser.web_vital.navigation_url': 'https://shop.example.com/u/[ID]',
    'browser.web_vital.navigation_id': 2,
  });
});
