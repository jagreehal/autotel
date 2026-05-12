/**
 * Contract Testing Observability Wrapper
 *
 * Provides a reusable abstraction for instrumenting contract testing workflows with:
 * - Automatic tracing of health audit phases
 * - Per-pair error classification with codes and remediation guidance
 * - Product event emission for trend analysis
 * - Request-scoped logging for execution snapshots
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  createStructuredError,
  getRequestLogger,
  trace,
  track,
} from 'autotel';

/** Contract testing mode */
export type ContractMode =
  | 'full' // Full workflow with all phases
  | 'status' // Status check only
  | 'stale' // Check for stale contracts
  | 'uncommitted' // Check for uncommitted changes
  | 'sync-gaps' // Check for sync gaps
  | 'missing' // Check for missing provider copies
  | 'docs' // Documentation generation
  | 'disabled' // Tests disabled
  | 'matrix'; // Matrix workflow

/** Type of difference in contract */
export type ContractDiffType =
  | 'none' // No differences
  | 'uuid-noise' // Only UUID noise (safe to ignore)
  | 'timestamp-noise' // Only timestamp noise (safe to ignore)
  | 'semantic-change'; // Semantic change (requires attention)

/** Overall health status of contract check run */
export type ContractStatus = 'ok' | 'warn' | 'fail' | 'skipped' | 'partial';

export interface ContractRunInput {
  service: string;
  mode: ContractMode;
  consumers: string[];
  providers: string[];
}

export interface ContractPairResult {
  consumer: string;
  provider: string;
  file: string;
  stale: boolean;
  syncGap: boolean;
  missingProviderCopy: boolean;
  uncommitted: boolean;
  verificationFailed: boolean;
  diffType: ContractDiffType;
  diffNoiseFields?: string[];
  reason?: string;
}

export interface ContractRunSummary {
  runId: string;
  status: ContractStatus;
  staleCount: number;
  missingProviderCount: number;
  uncommittedCount: number;
  syncGapCount: number;
  verifyFailedCount: number;
  checkedPairs: number;
}

export interface ContractObservabilityRunner {
  run(
    input: ContractRunInput,
    exec: () => Promise<ContractPairResult[]>,
  ): Promise<ContractRunSummary>;
}

const SERVICE_NAME = 'contract-observability-demo';

/**
 * Create a contract observability runner for instrumented contract testing
 *
 * @returns Runner that wraps contract testing workflows with observability
 *
 * @example
 * ```typescript
 * const runner = createContractObservabilityRunner();
 * const summary = await runner.run(
 *   { service: 'my-service', mode: 'full', consumers: [...], providers: [...] },
 *   async () => {
 *     // Perform contract generation, sync, normalize, verify
 *     return pairResults;
 *   }
 * );
 * ```
 */
export function createContractObservabilityRunner(): ContractObservabilityRunner {
  const runWithTrace = trace(
    'contract.health.audit',
    async (
      input: ContractRunInput,
      exec: () => Promise<ContractPairResult[]>,
    ): Promise<ContractRunSummary> => {
      const rootSpan = requireActiveSpan('contract.health.audit');
      const runId = randomUUID();
      const log = getRequestLogger();

        const workflowId = `${input.service}:${input.mode}:${Date.now()}`;

        rootSpan.setAttributes({
          'service.name': SERVICE_NAME,
          'contract.run_id': runId,
          'contract.workflow_id': workflowId,
          'contract.mode': input.mode,
          'contract.service': input.service,
          'contract.consumer_count': input.consumers.length,
          'contract.provider_count': input.providers.length,
        });

        log.set({
          run_id: runId,
          service: input.service,
          mode: input.mode,
          workflow_id: workflowId,
          consumer_count: input.consumers.length,
          provider_count: input.providers.length,
        });

        const pairResults = await exec();

        const staleCount = pairResults.filter((p) => p.stale).length;
        const missingProviderCount = pairResults.filter((p) => p.missingProviderCopy).length;
        const uncommittedCount = pairResults.filter((p) => p.uncommitted).length;
        const syncGapCount = pairResults.filter((p) => p.syncGap).length;
        const verifyFailedCount = pairResults.filter((p) => p.verificationFailed).length;

        const auditPair = trace(
          'contract.pair.audit',
          async (pair: ContractPairResult): Promise<void> => {
            const pairSpan = requireActiveSpan('contract.pair.audit');
            const versionHash = createHash('sha1').update(pair.file).digest('hex').slice(0, 12);

            pairSpan.setAttributes({
              'contract.run_id': runId,
              'contract.workflow_id': workflowId,
              'contract.consumer': pair.consumer,
              'contract.provider': pair.provider,
              'contract.pair': `${pair.consumer}->${pair.provider}`,
              'contract.file': pair.file,
              'contract.version_hash': versionHash,
              'contract.check': inferCheck(pair),
              'contract.status': inferStatus(pair),
              'contract.diff_type': pair.diffType,
            });

            if (pair.diffNoiseFields && pair.diffNoiseFields.length > 0) {
              pairSpan.setAttribute(
                'contract.diff_noise_fields',
                pair.diffNoiseFields.join(','),
              );
            }

            if (pair.verificationFailed || pair.missingProviderCopy) {
              const err = createStructuredError({
                message: pair.reason ?? 'Contract verification failed',
                why: `Pair ${pair.consumer}->${pair.provider} failed contract checks.`,
                fix: 'Sync pacts, normalize generated values, and re-run provider verification.',
                link: 'https://docs.pact.io/',
                status: 500,
                code: pair.missingProviderCopy
                  ? 'CONTRACT_MISSING_PROVIDER_COPY'
                  : 'PROVIDER_VERIFY_FAILED',
              });

              log.error(err, {
                pair: `${pair.consumer}->${pair.provider}`,
                contract_file: pair.file,
                diff_type: pair.diffType,
              });
            }
          },
        );

        for (const pair of pairResults) {
          await auditPair(pair);
        }

        const finalStatus: ContractStatus =
          verifyFailedCount > 0 || missingProviderCount > 0
            ? 'fail'
            : staleCount > 0 || syncGapCount > 0 || uncommittedCount > 0
              ? 'warn'
              : 'ok';

        const summary: ContractRunSummary = {
          runId,
          status: finalStatus,
          staleCount,
          missingProviderCount,
          uncommittedCount,
          syncGapCount,
          verifyFailedCount,
          checkedPairs: pairResults.length,
        };

        rootSpan.setAttributes({
          'contract.status': summary.status,
          'contract.stale_count': summary.staleCount,
          'contract.missing_provider_count': summary.missingProviderCount,
          'contract.uncommitted_count': summary.uncommittedCount,
          'contract.sync_gap_count': summary.syncGapCount,
          'contract.verify_failed_count': summary.verifyFailedCount,
          'contract.checked_pairs': summary.checkedPairs,
        });

        log.set({
          status: summary.status,
          stale_count: summary.staleCount,
          missing_provider_count: summary.missingProviderCount,
          uncommitted_count: summary.uncommittedCount,
          sync_gap_count: summary.syncGapCount,
          verify_failed_count: summary.verifyFailedCount,
          checked_pairs: summary.checkedPairs,
        });

        track('contract_check_completed', {
          run_id: runId,
          service: input.service,
          mode: input.mode,
          status: summary.status,
          checked_pairs: summary.checkedPairs,
          stale_count: summary.staleCount,
          missing_provider_count: summary.missingProviderCount,
          uncommitted_count: summary.uncommittedCount,
          sync_gap_count: summary.syncGapCount,
          verify_failed_count: summary.verifyFailedCount,
        });

        if (summary.uncommittedCount > 0 || summary.syncGapCount > 0) {
          track('contract_sync_performed', {
            run_id: runId,
            service: input.service,
            mode: input.mode,
            changed_pairs: summary.uncommittedCount + summary.syncGapCount,
          });
        }

        if (summary.verifyFailedCount > 0) {
          track('contract_verification_failed', {
            run_id: runId,
            service: input.service,
            mode: input.mode,
            failed_pairs: summary.verifyFailedCount,
          });
        }

        log.emitNow();
        return summary;
    },
  );

  return {
    async run(
      input: ContractRunInput,
      exec: () => Promise<ContractPairResult[]>,
    ): Promise<ContractRunSummary> {
      return runWithTrace(input, exec);
    },
  };
}

function requireActiveSpan(spanName: string) {
  const current = trace.getActiveSpan();
  if (!current) {
    throw new Error(`[autotel-demo] Active span missing for ${spanName}`);
  }
  return current;
}

function inferStatus(pair: ContractPairResult): ContractStatus {
  if (pair.verificationFailed || pair.missingProviderCopy) return 'fail';
  if (pair.stale || pair.syncGap || pair.uncommitted) return 'warn';
  return 'ok';
}

function inferCheck(pair: ContractPairResult): string {
  if (pair.verificationFailed) return 'provider.verify';
  if (pair.syncGap) return 'sync-gap';
  if (pair.missingProviderCopy) return 'missing-provider';
  if (pair.uncommitted) return 'uncommitted';
  if (pair.stale) return 'stale';
  return 'clean';
}
