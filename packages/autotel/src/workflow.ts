/**
 * Workflow and Saga tracing helpers
 *
 * Provides specialized tracing for multi-step workflows and sagas with
 * automatic step linking, compensation tracking, and workflow correlation.
 *
 * @example Simple workflow
 * ```typescript
 * import { traceWorkflow, traceStep } from 'autotel/workflow';
 *
 * export const processOrder = traceWorkflow({
 *   name: 'OrderFulfillment',
 *   workflowId: (order) => order.id,
 * })(ctx => async (order: Order) => {
 *   await validateOrder(order);
 *   await chargePayment(order);
 *   await shipOrder(order);
 * });
 * ```
 *
 * @example Saga with compensation
 * ```typescript
 * import { traceWorkflow, traceStep } from 'autotel/workflow';
 *
 * export const orderSaga = traceWorkflow({
 *   name: 'OrderSaga',
 *   workflowId: () => generateUUID(),
 * })(ctx => async (order: Order) => {
 *
 *   const reserveStep = traceStep({
 *     name: 'ReserveInventory',
 *     compensate: async () => {
 *       await releaseInventory(order.items);
 *     },
 *   })(async () => {
 *     await inventoryService.reserve(order.items);
 *   });
 *   await reserveStep();
 *
 *   const paymentStep = traceStep({
 *     name: 'ProcessPayment',
 *     linkToPrevious: true,
 *     compensate: async () => {
 *       await refundPayment(order.paymentId);
 *     },
 *   })(async () => {
 *     await paymentService.charge(order);
 *   });
 *   await paymentStep();
 * });
 * ```
 *
 * @module
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Attributes, Link, SpanContext } from '@opentelemetry/api';
import { trace } from './functional';
import type { TraceContext } from './trace-context';
import { getActiveSpan } from './trace-helpers';

// ============================================================================
// Types
// ============================================================================

/**
 * Workflow status
 */
export type WorkflowStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'compensating'
  | 'compensated'
  | 'compensation_failed';

/**
 * Step status
 */
export type StepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'compensated';

/**
 * Configuration for workflow tracing
 */
export interface WorkflowConfig<TArgs extends unknown[] = unknown[]> {
  /** Workflow name (e.g., 'OrderFulfillment', 'UserOnboarding') */
  name: string;

  /**
   * Function to extract or generate workflow ID
   * Can be static string, function of args, or generator
   */
  workflowId: string | ((...args: TArgs) => string);

  /** Optional workflow version */
  version?: string;

  /** Additional attributes */
  attributes?: Attributes;

  /** Callback on workflow completion */
  onComplete?: (ctx: WorkflowContext, result: unknown) => void;

  /** Callback on workflow failure */
  onFailed?: (ctx: WorkflowContext, error: Error) => void;

  /** Callback on compensation start */
  onCompensating?: (ctx: WorkflowContext) => void;
}

/**
 * Configuration for workflow step tracing
 */
export interface StepConfig {
  /** Step name */
  name: string;

  /** Optional step description */
  description?: string;

  /** Step index (auto-assigned if not provided) */
  index?: number;

  /** Link to previous step span */
  linkToPrevious?: boolean;

  /** Link to specific step(s) by name */
  linkTo?: string | string[];

  /** Additional attributes */
  attributes?: Attributes;

  /** Compensation handler for saga rollback */
  compensate?: (error: Error) => Promise<void> | void;

  /** Whether this step is idempotent */
  idempotent?: boolean;

  /** Retry configuration */
  retry?: {
    maxAttempts: number;
    backoffMs?: number;
  };

  /** Callback on step completion */
  onComplete?: (ctx: StepContext) => void;

  /** Callback on step failure */
  onFailed?: (ctx: StepContext, error: Error) => void;
}

/**
 * Step metadata stored for linking and compensation
 */
interface StepMetadata {
  name: string;
  index: number;
  status: StepStatus;
  spanContext?: SpanContext;
  compensate?: (error: Error) => Promise<void> | void;
  startTime: number;
  endTime?: number;
}

/**
 * Extended trace context for workflows
 */
export interface WorkflowContext extends TraceContext {
  /** Get the workflow ID */
  getWorkflowId(): string;

  /** Get workflow name */
  getWorkflowName(): string;

  /** Get current workflow status */
  getStatus(): WorkflowStatus;

  /** Mark step as completed and store for linking */
  completeStep(stepName: string): void;

  /** Get previous step's span context for linking */
  getPreviousStep(stepName?: string): SpanContext | null;

  /** Get all completed steps */
  getCompletedSteps(): string[];

  /** Register a compensation handler */
  registerCompensation(
    stepName: string,
    handler: (error: Error) => Promise<void> | void,
  ): void;

  /** Trigger compensation for all registered steps */
  compensate(error: Error): Promise<void>;

  /** Record compensation result */
  recordCompensation(stepName: string, success: boolean, error?: Error): void;

  /** Set workflow status */
  setWorkflowStatus(status: WorkflowStatus): void;
}

/**
 * Extended trace context for workflow steps
 */
export interface StepContext extends TraceContext {
  /** Get step name */
  getStepName(): string;

  /** Get step index */
  getStepIndex(): number;

  /** Mark this step as completed */
  complete(): void;

  /** Skip this step */
  skip(reason?: string): void;

  /** Get workflow context */
  getWorkflowContext(): WorkflowContext | null;
}

// ============================================================================
// Storage
// ============================================================================

// Store workflow state in a WeakMap keyed by span
const workflowStates = new WeakMap<
  object,
  {
    workflowId: string;
    workflowName: string;
    status: WorkflowStatus;
    steps: Map<string, StepMetadata>;
    stepCounter: number;
    compensations: Map<string, (error: Error) => Promise<void> | void>;
  }
>();

/**
 * AsyncLocalStorage for workflow context (async-safe)
 *
 * This replaces the previous module-level variable which was NOT safe for
 * concurrent workflows. AsyncLocalStorage ensures each async execution chain
 * has its own isolated workflow context.
 */
const workflowContextStorage = new AsyncLocalStorage<WorkflowContext>();

// ============================================================================
// Workflow Helper
// ============================================================================

/**
 * Create a traced workflow function
 *
 * Wraps business logic in a workflow span with automatic step tracking,
 * correlation via workflow ID, and compensation support.
 *
 * @param config - Workflow configuration
 * @returns Factory function that wraps your workflow logic
 *
 * @example Order fulfillment workflow
 * ```typescript
 * export const fulfillOrder = traceWorkflow({
 *   name: 'OrderFulfillment',
 *   workflowId: (order) => order.id,
 *   version: '2.0',
 * })(ctx => async (order: Order) => {
 *   ctx.setAttribute('order.total', order.total);
 *
 *   await validateOrder(order);
 *   await processPayment(order);
 *   await fulfillItems(order);
 *   await notifyCustomer(order);
 *
 *   return { success: true, orderId: order.id };
 * });
 * ```
 */
export function traceWorkflow<TArgs extends unknown[], TReturn>(
  config: WorkflowConfig<TArgs>,
) {
  const spanName = `workflow.${config.name}`;

  return (
    fnFactory: (ctx: WorkflowContext) => (...args: TArgs) => Promise<TReturn>,
  ): ((...args: TArgs) => Promise<TReturn>) => {
    return trace<TArgs, TReturn>(spanName, (baseCtx) => {
      return async (...args: TArgs) => {
        // Generate or extract workflow ID
        const workflowId =
          typeof config.workflowId === 'function'
            ? config.workflowId(...args)
            : config.workflowId;

        // Create workflow context
        const ctx = createWorkflowContext(baseCtx, config.name, workflowId);

        // Set workflow attributes
        ctx.setAttribute('workflow.name', config.name);
        ctx.setAttribute('workflow.id', workflowId);
        if (config.version) {
          ctx.setAttribute('workflow.version', config.version);
        }
        ctx.setAttribute('workflow.status', 'running');

        // Set custom attributes
        if (config.attributes) {
          for (const [key, value] of Object.entries(config.attributes)) {
            if (value !== undefined) {
              ctx.setAttribute(key, value as string | number | boolean);
            }
          }
        }

        // Run workflow in AsyncLocalStorage context for async-safety
        // This ensures concurrent workflows have isolated contexts
        return workflowContextStorage.run(ctx, async () => {
          try {
            // Execute workflow
            const userFn = fnFactory(ctx);
            const result = await userFn(...args);

            // Mark as completed
            ctx.setWorkflowStatus('completed');
            config.onComplete?.(ctx, result);

            return result;
          } catch (error) {
            // Mark as failed
            ctx.setWorkflowStatus('failed');
            config.onFailed?.(ctx, error as Error);

            // Check if we have compensations to run
            const state = getWorkflowState();
            if (state && state.compensations.size > 0) {
              ctx.setWorkflowStatus('compensating');
              config.onCompensating?.(ctx);

              try {
                await ctx.compensate(error as Error);
                ctx.setWorkflowStatus('compensated');
              } catch (compensationError) {
                ctx.setWorkflowStatus('compensation_failed');
                ctx.setAttribute(
                  'workflow.compensation.error',
                  String(compensationError),
                );
              }
            }

            throw error;
          }
        });
      };
    });
  };
}

/**
 * Create a traced workflow step
 *
 * Wraps step logic with automatic linking to previous steps,
 * compensation registration, and status tracking.
 *
 * @param config - Step configuration
 * @returns Factory function that wraps your step logic
 *
 * @example Step with compensation
 * ```typescript
 * const chargePayment = traceStep({
 *   name: 'ChargePayment',
 *   linkToPrevious: true,
 *   compensate: async (error) => {
 *     await paymentService.refund(paymentId);
 *   },
 * })(async (amount: number) => {
 *   return await paymentService.charge(amount);
 * });
 * ```
 */
export function traceStep<TArgs extends unknown[], TReturn>(
  config: StepConfig,
) {
  return (
    fn: (...args: TArgs) => Promise<TReturn>,
  ): ((...args: TArgs) => Promise<TReturn>) => {
    const spanName = `step.${config.name}`;

    return trace<TArgs, TReturn>(spanName, (baseCtx) => {
      return async (...args: TArgs) => {
        // Get workflow context from AsyncLocalStorage (async-safe)
        const workflowCtx = workflowContextStorage.getStore() ?? null;

        // Create step context
        const ctx = createStepContext(baseCtx, config, workflowCtx);

        // Set step attributes
        ctx.setAttribute('workflow.step.name', config.name);
        ctx.setAttribute('workflow.step.index', ctx.getStepIndex());
        ctx.setAttribute('workflow.step.status', 'running');

        if (config.description) {
          ctx.setAttribute('workflow.step.description', config.description);
        }

        if (config.idempotent) {
          ctx.setAttribute('workflow.step.idempotent', true);
        }

        // Set custom attributes
        if (config.attributes) {
          for (const [key, value] of Object.entries(config.attributes)) {
            if (value !== undefined) {
              ctx.setAttribute(key, value as string | number | boolean);
            }
          }
        }

        // Link to previous steps
        await addStepLinks(ctx, config, workflowCtx);

        // Register compensation if provided
        if (config.compensate && workflowCtx) {
          workflowCtx.registerCompensation(config.name, config.compensate);
        }

        // Execute with optional retry
        let lastError: Error | undefined;
        const maxAttempts = config.retry?.maxAttempts ?? 1;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            if (attempt > 1) {
              ctx.setAttribute('workflow.step.retry_attempt', attempt);
              ctx.addEvent('step_retry', {
                'workflow.step.attempt': attempt,
                'workflow.step.max_attempts': maxAttempts,
              });

              // Backoff
              if (config.retry?.backoffMs) {
                await sleep(config.retry.backoffMs * attempt);
              }
            }

            const result = await fn(...args);

            // Mark as completed
            ctx.setAttribute('workflow.step.status', 'completed');
            ctx.complete();
            config.onComplete?.(ctx);

            return result;
          } catch (error) {
            lastError = error as Error;

            if (attempt < maxAttempts) {
              ctx.addEvent('step_retry_scheduled', {
                'workflow.step.error': String(error),
                'workflow.step.attempt': attempt,
              });
            }
          }
        }

        // All attempts failed
        ctx.setAttribute('workflow.step.status', 'failed');
        ctx.setAttribute('workflow.step.error', String(lastError));
        config.onFailed?.(ctx, lastError!);

        throw lastError;
      };
    });
  };
}

// ============================================================================
// Context Creation
// ============================================================================

/**
 * Create workflow-extended context
 */
function createWorkflowContext(
  baseCtx: TraceContext,
  workflowName: string,
  workflowId: string,
): WorkflowContext {
  // Initialize state
  const span = getActiveSpan();
  const state = {
    workflowId,
    workflowName,
    status: 'running' as WorkflowStatus,
    steps: new Map<string, StepMetadata>(),
    stepCounter: 0,
    compensations: new Map<string, (error: Error) => Promise<void> | void>(),
  };

  if (span) {
    workflowStates.set(span, state);
  }

  return {
    ...baseCtx,

    getWorkflowId(): string {
      return workflowId;
    },

    getWorkflowName(): string {
      return workflowName;
    },

    getStatus(): WorkflowStatus {
      return state.status;
    },

    completeStep(stepName: string): void {
      let step = state.steps.get(stepName);
      if (!step) {
        // Auto-create step entry for manually managed steps
        // (when using registerCompensation without traceStep)
        step = {
          name: stepName,
          index: state.stepCounter++,
          status: 'pending',
          startTime: Date.now(),
        };
        state.steps.set(stepName, step);
      }
      step.status = 'completed';
      step.endTime = Date.now();

      // Capture span context for linking
      const currentSpan = getActiveSpan();
      if (currentSpan) {
        step.spanContext = currentSpan.spanContext();
      }
    },

    getPreviousStep(stepName?: string): SpanContext | null {
      if (stepName) {
        const step = state.steps.get(stepName);
        return step?.spanContext ?? null;
      }

      // Get last completed step
      let lastStep: StepMetadata | null = null;
      for (const step of state.steps.values()) {
        if (
          step.status === 'completed' &&
          (!lastStep || step.index > lastStep.index)
        ) {
          lastStep = step;
        }
      }

      return lastStep?.spanContext ?? null;
    },

    getCompletedSteps(): string[] {
      const completed: string[] = [];
      for (const [name, step] of state.steps) {
        if (step.status === 'completed') {
          completed.push(name);
        }
      }
      return completed.toSorted(
        (a, b) =>
          (state.steps.get(a)?.index ?? 0) - (state.steps.get(b)?.index ?? 0),
      );
    },

    registerCompensation(
      stepName: string,
      handler: (error: Error) => Promise<void> | void,
    ): void {
      state.compensations.set(stepName, handler);
    },

    async compensate(error: Error): Promise<void> {
      // Execute compensations in reverse order
      const compensationOrder = [...state.compensations.entries()].toReversed();

      for (const [stepName, handler] of compensationOrder) {
        const step = state.steps.get(stepName);
        if (step && step.status === 'completed') {
          try {
            baseCtx.addEvent('compensation_started', {
              'workflow.step.name': stepName,
            });

            await Promise.resolve(handler(error));

            this.recordCompensation(stepName, true);
            step.status = 'compensated';
          } catch (compensationError) {
            this.recordCompensation(
              stepName,
              false,
              compensationError as Error,
            );
            throw compensationError;
          }
        }
      }
    },

    recordCompensation(
      stepName: string,
      success: boolean,
      error?: Error,
    ): void {
      baseCtx.addEvent('compensation_completed', {
        'workflow.step.name': stepName,
        'workflow.compensation.success': success,
        ...(error && { 'workflow.compensation.error': String(error) }),
      });

      baseCtx.setAttribute(
        `workflow.compensation.${stepName}`,
        success ? 'success' : 'failed',
      );
    },

    setWorkflowStatus(status: WorkflowStatus): void {
      state.status = status;
      baseCtx.setAttribute('workflow.status', status);

      baseCtx.addEvent('workflow_status_changed', {
        'workflow.status': status,
      });
    },
  };
}

/**
 * Create step-extended context
 */
function createStepContext(
  baseCtx: TraceContext,
  config: StepConfig,
  workflowCtx: WorkflowContext | null,
): StepContext {
  // Determine step index
  let stepIndex = config.index ?? 0;
  if (workflowCtx) {
    const span = getActiveSpan();
    if (span) {
      const state = workflowStates.get(span);
      if (state) {
        stepIndex = config.index ?? state.stepCounter++;
      }
    }
  }

  // Register step metadata
  if (workflowCtx) {
    const wfSpan = getActiveSpan();
    if (wfSpan) {
      const state = workflowStates.get(wfSpan);
      if (state) {
        state.steps.set(config.name, {
          name: config.name,
          index: stepIndex,
          status: 'running',
          startTime: Date.now(),
          compensate: config.compensate,
        });
      }
    }
  }

  return {
    ...baseCtx,

    getStepName(): string {
      return config.name;
    },

    getStepIndex(): number {
      return stepIndex;
    },

    complete(): void {
      if (workflowCtx) {
        workflowCtx.completeStep(config.name);
      }
    },

    skip(reason?: string): void {
      baseCtx.setAttribute('workflow.step.status', 'skipped');
      if (reason) {
        baseCtx.setAttribute('workflow.step.skip_reason', reason);
      }
      baseCtx.addEvent('step_skipped', {
        'workflow.step.name': config.name,
        ...(reason && { 'workflow.step.skip_reason': reason }),
      });
    },

    getWorkflowContext(): WorkflowContext | null {
      return workflowCtx;
    },
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get workflow state from context
 */
function getWorkflowState() {
  const span = getActiveSpan();
  return span ? workflowStates.get(span) : null;
}

/**
 * Add links to previous steps
 */
async function addStepLinks(
  ctx: StepContext,
  config: StepConfig,
  workflowCtx: WorkflowContext | null,
): Promise<void> {
  if (!workflowCtx) return;

  const links: Link[] = [];

  // Link to previous step
  if (config.linkToPrevious) {
    const prevSpanContext = workflowCtx.getPreviousStep();
    if (prevSpanContext) {
      links.push({
        context: prevSpanContext,
        attributes: {
          'workflow.link.type': 'sequence',
        },
      });
    }
  }

  // Link to specific steps
  if (config.linkTo) {
    const stepNames = Array.isArray(config.linkTo)
      ? config.linkTo
      : [config.linkTo];

    for (const stepName of stepNames) {
      const spanContext = workflowCtx.getPreviousStep(stepName);
      if (spanContext) {
        links.push({
          context: spanContext,
          attributes: {
            'workflow.link.type': 'dependency',
            'workflow.link.step': stepName,
          },
        });
      }
    }
  }

  // Add all links
  if (links.length > 0) {
    ctx.addLinks(links);
  }
}

/**
 * Sleep utility for retry backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Convenience Exports
// ============================================================================

/**
 * Get current workflow context (if inside a workflow)
 *
 * Uses AsyncLocalStorage to ensure async-safety when multiple
 * workflows are running concurrently.
 */
export function getCurrentWorkflowContext(): WorkflowContext | null {
  return workflowContextStorage.getStore() ?? null;
}

/**
 * Check if currently executing inside a workflow
 *
 * Uses AsyncLocalStorage to ensure async-safety when multiple
 * workflows are running concurrently.
 */
export function isInWorkflow(): boolean {
  return workflowContextStorage.getStore() !== undefined;
}
