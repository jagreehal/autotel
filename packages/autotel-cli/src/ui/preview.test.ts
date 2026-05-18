import { describe, expect, it } from 'vitest';
import { renderPlanPreview } from './preview';
import type { InitPlan } from '../lib/plan';

// Strip ANSI codes so the assertions don't depend on chalk's colour codes.
const ESC = String.fromCodePoint(0x00_1B);
const ANSI_RE = new RegExp(`${ESC}${String.raw`\[[0-9;]*m`}`, 'g');
function stripAnsi(s: string): string {
  return s.replaceAll(ANSI_RE, '');
}

const samplePlan: InitPlan = {
  v: 1,
  presets: ['hono', 'posthog', 'sentry'],
  packagesToInstall: {
    prod: ['autotel', 'autotel-hono', 'autotel-subscribers', 'autotel-sentry'],
    dev: [],
  },
  filesToWrite: [{ path: 'src/instrumentation.mts', action: 'create' }],
  envVars: [
    { name: 'POSTHOG_API_KEY', sensitive: true, action: 'add-to-.env.example' },
    { name: 'SENTRY_DSN', sensitive: true, action: 'add-to-.env.example' },
  ],
  nextSteps: ['Run pnpm install', 'Copy .env.example to .env'],
  detected: {
    packages: [
      { name: 'hono', version: '^4.0.0', resolution: 'target' },
      { name: 'pino', version: '^9.0.0', resolution: 'target' },
    ],
    primaryLogger: 'pino',
    autoInstrumentLoggers: ['winston'],
    autoInstrumentedDeps: ['express', 'pg'],
    backend: { slug: 'datadog', source: 'env', detail: 'DD_API_KEY' },
    platform: null,
  },
};

describe('renderPlanPreview', () => {
  it('includes detected packages, logger, auto-instrumented deps, backend', () => {
    const out = stripAnsi(renderPlanPreview(samplePlan));
    expect(out).toContain('hono@^4.0.0');
    expect(out).toContain('pino@^9.0.0');
    expect(out).toContain('Logger: pino (first-class)');
    expect(out).toContain('+ auto-instrumented: winston');
    expect(out).toContain('Covered by auto-instrumentations-node: express, pg');
    expect(out).toContain('Backend: datadog');
    expect(out).toContain('env: DD_API_KEY');
  });

  it('lists the wired presets with + markers', () => {
    const out = stripAnsi(renderPlanPreview(samplePlan));
    expect(out).toContain('+ hono');
    expect(out).toContain('+ posthog');
    expect(out).toContain('+ sentry');
  });

  it('lists the install set and env vars with sensitivity marker', () => {
    const out = stripAnsi(renderPlanPreview(samplePlan));
    expect(out).toContain('Install: autotel, autotel-hono');
    expect(out).toContain('SENTRY_DSN [sensitive]');
    expect(out).toContain('POSTHOG_API_KEY [sensitive]');
  });

  it('renders without the detected block when omitted', () => {
    const out = stripAnsi(renderPlanPreview({ ...samplePlan, detected: undefined }));
    expect(out).not.toContain('Detected packages:');
  });
});
