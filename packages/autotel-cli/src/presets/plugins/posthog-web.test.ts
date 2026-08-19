import { describe, expect, it } from 'vitest';
import { posthogWeb } from './posthog-web';

/** Parses a statement body without needing Node's ESM-in-vm flag. */
const parses = (source: string) => () => new Function(source);

describe('posthog-web preset', () => {
  it('puts nothing browser-side into the Node instrumentation file', () => {
    // The generated file runs in the server process, where `posthog` does not
    // exist. An import of the browser join here loads a module that process
    // can never use.
    expect(posthogWeb.imports).toEqual([]);
  });

  it('emits a config block that still parses as a module', () => {
    // The earlier version wrote `spanEnrichers: [...]` into the statement
    // section — a bare object property at top level, which is a syntax error
    // that takes the whole instrumentation file down with it.
    const body = ['init({});', posthogWeb.configBlock.code, ''].join('\n');

    expect(parses(body)).not.toThrow();
    // And the shape that broke: a config property stranded at statement level.
    expect(parses('init({});\nspanEnrichers: [x()],\n')).toThrow();
  });

  it('installs the browser packages, not the server subscriber', () => {
    // posthog-js is required, not optional: the join reads its session and the
    // package is typed against it, so a project without it has nothing to join.
    expect(posthogWeb.packages.required).toEqual([
      'autotel-web',
      'autotel-posthog',
      'posthog-js',
    ]);
  });

  it('teaches the one-call form', () => {
    // Two wiring steps in two files is how an integration ends up half-done.
    expect(posthogWeb.configBlock.code).toContain('joinPostHog(posthog)');
    expect(posthogWeb.nextSteps[0]).toContain('joinPostHog');
  });
});
