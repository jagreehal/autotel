/**
 * Shared helpers for end-to-end tests against real OTLP backends.
 *
 * These tests:
 *   - skip when the required env vars aren't set
 *   - tag every span with a unique correlation id + run/branch/sha so the
 *     spans are identifiable and easy to clean up later
 *   - exercise the public OTLP exporter against a real endpoint (no mocks)
 *
 * They are NOT part of the default `pnpm test` run — see
 * `vitest.e2e.config.ts` and `pnpm run test:e2e`.
 */
import { randomUUID } from 'node:crypto';
import { describe, it } from 'vitest';

export interface RunMetadata {
  runId: string;
  branch: string;
  sha: string;
  ci: boolean;
}

export interface E2EAttributes extends Record<
  string,
  string | number | boolean
> {
  e2e: true;
  e2e_run_id: string;
  e2e_branch: string;
  e2e_sha: string;
  e2e_test: string;
  e2e_correlation_id: string;
}

export function getRunMetadata(): RunMetadata {
  const ci = Boolean(process.env.GITHUB_ACTIONS);
  return {
    runId: process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`,
    branch: process.env.GITHUB_REF_NAME ?? 'local',
    sha: (process.env.GITHUB_SHA ?? 'local').slice(0, 7),
    ci,
  };
}

/**
 * Build a tag bag for a single span. The correlation id is unique per call,
 * so each emitted span can be located individually in the destination.
 */
export function makeAttributes(testName: string): E2EAttributes {
  const meta = getRunMetadata();
  return {
    e2e: true,
    e2e_run_id: meta.runId,
    e2e_branch: meta.branch,
    e2e_sha: meta.sha,
    e2e_test: testName,
    e2e_correlation_id: randomUUID(),
  };
}

/**
 * `describe.skipIf` wrapper that prints why a suite was skipped — important so
 * a missing token in CI is visible in the logs instead of silently green.
 */
export function describeIfEnv(
  name: string,
  envVars: string[],
  fn: () => void,
): void {
  const missing = envVars.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    describe.skip(`${name} (skipped: missing ${missing.join(', ')})`, fn);
    return;
  }
  describe(name, fn);
}

/**
 * `it` with a friendlier label that prints the correlation id on failure, so
 * when a real backend fails you can grep the destination platform.
 */
export function itWithCorrelationId(
  name: string,
  fn: (correlationId: string) => Promise<void>,
  timeoutMs?: number,
): void {
  it(
    name,
    async () => {
      const correlationId = randomUUID();
      try {
        await fn(correlationId);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        err.message = `${err.message}\n   ↳ correlation_id: ${correlationId}`;
        throw err;
      }
    },
    timeoutMs,
  );
}

/**
 * Poll a predicate until it returns truthy or the timeout elapses.
 * Used by backends with a query API (e.g. Honeycomb) to wait for ingestion lag.
 */
export async function pollUntil<T>(
  predicate: () => Promise<T | null | undefined>,
  options: { timeoutMs: number; intervalMs: number; label: string },
): Promise<T> {
  const { timeoutMs, intervalMs, label } = options;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts += 1;
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(
    `[${label}] pollUntil timed out after ${timeoutMs}ms (${attempts} attempts)${
      lastError
        ? `; last error: ${(lastError as Error).message ?? lastError}`
        : ''
    }`,
  );
}
