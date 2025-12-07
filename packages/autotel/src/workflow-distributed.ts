/**
 * Distributed workflow tracing with cross-service correlation
 *
 * Enables tracking workflows that span multiple microservices by propagating
 * workflow identity (workflowId, stepName, stepIndex) via baggage in message headers.
 *
 * Unlike local workflow.ts (which uses AsyncLocalStorage), distributed workflows
 * propagate context across network boundaries using W3C baggage.
 *
 * @example Order fulfillment saga across services
 * ```typescript
 * // Service A: Order Service
 * import { traceDistributedWorkflow, WorkflowBaggage } from 'autotel/workflow-distributed';
 * import { traceProducer } from 'autotel/messaging';
 *
 * export const createOrder = traceDistributedWorkflow({
 *   name: 'OrderFulfillment',
 *   workflowIdFrom: (order) => order.id,
 *   version: '1.0.0',
 * })(ctx => async (order: Order) => {
 *   // Workflow baggage is auto-set
 *   await publishToInventory(order);
 * });
 *
 * const publishToInventory = traceProducer({
 *   system: 'kafka',
 *   destination: 'inventory-requests',
 *   propagateBaggage: true,  // Includes workflow.* baggage
 * })(ctx => async (order) => {
 *   await producer.send({ topic: 'inventory-requests', value: order });
 * });
 *
 * // Service B: Inventory Service
 * import { traceDistributedStep, WorkflowBaggage } from 'autotel/workflow-distributed';
 *
 * export const processInventory = traceDistributedStep({
 *   name: 'ReserveInventory',
 *   extractBaggage: true,  // Extracts workflow.* from headers
 * })(ctx => async (message) => {
 *   const workflow = WorkflowBaggage.get(ctx);
 *   // workflow.workflowId === order.id (propagated from Service A)
 *   console.log(`Processing step for workflow ${workflow.workflowId}`);
 *   await reserveItems(message.items);
 * });
 * ```
 *
 * @module
 */

import { context, propagation, SpanKind } from '@opentelemetry/api';
import { createSafeBaggageSchema } from './business-baggage';
import { trace } from './functional';
import type { TraceContext } from './trace-context';

// ============================================================================
// Workflow Baggage Schema
// ============================================================================

/**
 * Workflow baggage field definitions
 */
const workflowBaggageFields = {
  /** Unique identifier for the workflow instance */
  workflowId: { type: 'string' as const, maxLength: 128, required: true },

  /** Name/type of the workflow (e.g., "OrderFulfillment") */
  workflowName: { type: 'string' as const, maxLength: 64, required: true },

  /** Version of the workflow definition */
  workflowVersion: { type: 'string' as const, maxLength: 32 },

  /** Current step name */
  stepName: { type: 'string' as const, maxLength: 64 },

  /** Current step index (0-based) */
  stepIndex: { type: 'number' as const },

  /** Total number of steps (if known) */
  totalSteps: { type: 'number' as const },

  /** Parent workflow ID (for sub-workflows) */
  parentWorkflowId: { type: 'string' as const, maxLength: 128 },

  /** Correlation ID for external systems */
  correlationId: { type: 'string' as const, maxLength: 128 },

  /** Workflow priority */
  priority: {
    type: 'enum' as const,
    values: ['low', 'normal', 'high', 'critical'] as const,
  },

  /** Initiating user/system */
  initiatedBy: { type: 'string' as const, maxLength: 64 },

  /** Workflow start timestamp (ISO) */
  startedAt: { type: 'string' as const, maxLength: 30 },
} as const;

/**
 * Pre-built baggage schema for distributed workflows
 *
 * Use this to read/write workflow context that propagates across services.
 *
 * @example Setting workflow baggage
 * ```typescript
 * WorkflowBaggage.set(ctx, {
 *   workflowId: 'order-12345',
 *   workflowName: 'OrderFulfillment',
 *   stepName: 'ReserveInventory',
 *   stepIndex: 1,
 * });
 * ```
 *
 * @example Reading workflow baggage in downstream service
 * ```typescript
 * const { workflowId, workflowName, stepIndex } = WorkflowBaggage.get(ctx);
 * console.log(`Processing ${workflowName} step ${stepIndex}`);
 * ```
 */
export const WorkflowBaggage = createSafeBaggageSchema(workflowBaggageFields, {
  prefix: 'workflow',
  hashHighCardinality: false, // Workflow IDs should be traceable
  redactPII: false, // Workflow fields are internal identifiers
});

/**
 * Type for workflow baggage values
 */
export type WorkflowBaggageValues = {
  workflowId: string;
  workflowName: string;
  workflowVersion?: string;
  stepName?: string;
  stepIndex?: number;
  totalSteps?: number;
  parentWorkflowId?: string;
  correlationId?: string;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  initiatedBy?: string;
  startedAt?: string;
};

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for distributed workflow tracing
 */
export interface DistributedWorkflowConfig {
  /** Workflow name/type (e.g., "OrderFulfillment", "UserOnboarding") */
  name: string;

  /**
   * Extract workflow ID from function arguments
   *
   * Receives all arguments passed to the workflow function, allowing
   * multi-parameter handlers to derive workflow IDs from any argument.
   *
   * @example Single argument
   * ```typescript
   * workflowIdFrom: (order) => order.id
   * ```
   *
   * @example Multiple arguments (payload + metadata)
   * ```typescript
   * workflowIdFrom: (payload, metadata) => metadata.correlationId ?? payload.id
   * ```
   */
  workflowIdFrom: (...args: unknown[]) => string;

  /** Workflow version (e.g., "1.0.0", "2023-01-15") */
  version?: string;

  /** Total number of steps if known */
  totalSteps?: number;

  /** Parent workflow ID (for sub-workflows) */
  parentWorkflowId?: string;

  /** Correlation ID for external systems */
  correlationId?: string;

  /** Workflow priority */
  priority?: 'low' | 'normal' | 'high' | 'critical';

  /** User/system that initiated the workflow */
  initiatedBy?: string;

  /** Additional span attributes */
  attributes?: Record<string, string | number | boolean>;

  /** Callback on workflow start */
  onStart?: (ctx: DistributedWorkflowContext) => void;

  /** Callback on workflow completion */
  onComplete?: (ctx: DistributedWorkflowContext, result: unknown) => void;

  /** Callback on workflow error */
  onError?: (ctx: DistributedWorkflowContext, error: Error) => void;
}

/**
 * Configuration for distributed workflow step
 */
export interface DistributedStepConfig {
  /** Step name (e.g., "ReserveInventory", "ChargePayment") */
  name: string;

  /**
   * Extract baggage from incoming message/request
   *
   * If true, reads workflow baggage from current context (assumes already extracted).
   * If function, extracts from arguments.
   *
   * @default true
   */
  extractBaggage?:
    | boolean
    | ((args: unknown[]) => WorkflowBaggageValues | null);

  /** Override step index (otherwise uses baggage or auto-increments) */
  stepIndex?: number;

  /** Additional span attributes */
  attributes?: Record<string, string | number | boolean>;

  /** Whether this step is idempotent (safe to retry) */
  idempotent?: boolean;

  /** Whether this step is a compensation/rollback step */
  isCompensation?: boolean;

  /** Callback on step start */
  onStart?: (ctx: DistributedStepContext) => void;

  /** Callback on step completion */
  onComplete?: (ctx: DistributedStepContext, result: unknown) => void;

  /** Callback on step error */
  onError?: (ctx: DistributedStepContext, error: Error) => void;
}

/**
 * Extended context for distributed workflow root
 */
export interface DistributedWorkflowContext extends TraceContext {
  /** The workflow ID */
  workflowId: string;

  /** The workflow name */
  workflowName: string;

  /** The workflow version */
  workflowVersion?: string;

  /** Get workflow baggage for propagation to other services */
  getWorkflowBaggage(): WorkflowBaggageValues;

  /** Set additional workflow baggage fields */
  setWorkflowBaggage(values: Partial<WorkflowBaggageValues>): void;

  /** Get headers with workflow baggage for outgoing requests */
  getWorkflowHeaders(): Record<string, string>;

  /** Record workflow step completion (for progress tracking) */
  recordStepProgress(stepName: string, stepIndex: number): void;
}

/**
 * Extended context for distributed workflow step
 */
export interface DistributedStepContext extends TraceContext {
  /** The workflow ID (from baggage) */
  workflowId: string | null;

  /** The workflow name (from baggage) */
  workflowName: string | null;

  /** The current step name */
  stepName: string;

  /** The current step index */
  stepIndex: number | null;

  /** Whether this step is a compensation */
  isCompensation: boolean;

  /** Get the full workflow baggage */
  getWorkflowBaggage(): WorkflowBaggageValues | null;

  /** Update workflow baggage (e.g., increment step index) */
  updateWorkflowBaggage(values: Partial<WorkflowBaggageValues>): void;

  /** Get headers with updated workflow baggage for downstream calls */
  getWorkflowHeaders(): Record<string, string>;

  /** Mark step as requiring compensation on failure */
  requiresCompensation(compensationData?: Record<string, unknown>): void;
}

// ============================================================================
// Distributed Workflow Tracer
// ============================================================================

/**
 * Create a traced distributed workflow function
 *
 * Wraps a function as the entry point for a distributed workflow. Automatically:
 * - Generates or extracts workflow ID
 * - Sets workflow baggage for downstream propagation
 * - Creates root span with workflow attributes
 *
 * @param config - Workflow configuration
 * @returns Factory function for the workflow handler
 *
 * @example Basic usage
 * ```typescript
 * export const createOrder = traceDistributedWorkflow({
 *   name: 'OrderFulfillment',
 *   workflowIdFrom: (order) => order.id,
 *   version: '1.0.0',
 * })(ctx => async (order: Order) => {
 *   ctx.recordStepProgress('ValidateOrder', 0);
 *   await validateOrder(order);
 *
 *   ctx.recordStepProgress('ReserveInventory', 1);
 *   await publishToInventoryService(order);
 *
 *   return { workflowId: ctx.workflowId, status: 'started' };
 * });
 * ```
 */
export function traceDistributedWorkflow<TArgs extends unknown[], TReturn>(
  config: DistributedWorkflowConfig,
) {
  const spanName = `workflow.${config.name}`;

  return (
    fnFactory: (
      ctx: DistributedWorkflowContext,
    ) => (...args: TArgs) => Promise<TReturn>,
  ): ((...args: TArgs) => Promise<TReturn>) => {
    return trace<TArgs, TReturn>(
      { name: spanName, spanKind: SpanKind.INTERNAL },
      (baseCtx) => {
        return async (...args: TArgs) => {
          // Extract workflow ID from arguments (spread to allow multi-arg access)
          const workflowId = config.workflowIdFrom(...args);
          const startedAt = new Date().toISOString();

          // Initialize workflow baggage
          const baggageValues: WorkflowBaggageValues = {
            workflowId,
            workflowName: config.name,
            workflowVersion: config.version,
            stepIndex: 0,
            totalSteps: config.totalSteps,
            parentWorkflowId: config.parentWorkflowId,
            correlationId: config.correlationId,
            priority: config.priority,
            initiatedBy: config.initiatedBy,
            startedAt,
          };

          // Set baggage
          WorkflowBaggage.set(baseCtx, baggageValues);

          // Set span attributes
          baseCtx.setAttribute('workflow.id', workflowId);
          baseCtx.setAttribute('workflow.name', config.name);
          if (config.version) {
            baseCtx.setAttribute('workflow.version', config.version);
          }
          if (config.totalSteps) {
            baseCtx.setAttribute('workflow.total_steps', config.totalSteps);
          }
          if (config.parentWorkflowId) {
            baseCtx.setAttribute('workflow.parent_id', config.parentWorkflowId);
          }
          if (config.priority) {
            baseCtx.setAttribute('workflow.priority', config.priority);
          }
          if (config.initiatedBy) {
            baseCtx.setAttribute('workflow.initiated_by', config.initiatedBy);
          }
          baseCtx.setAttribute('workflow.started_at', startedAt);

          // Apply custom attributes
          if (config.attributes) {
            for (const [key, value] of Object.entries(config.attributes)) {
              baseCtx.setAttribute(key, value);
            }
          }

          // Create extended context
          const workflowCtx: DistributedWorkflowContext = {
            ...baseCtx,
            workflowId,
            workflowName: config.name,
            workflowVersion: config.version,

            getWorkflowBaggage(): WorkflowBaggageValues {
              return { ...baggageValues };
            },

            setWorkflowBaggage(values: Partial<WorkflowBaggageValues>): void {
              Object.assign(baggageValues, values);
              WorkflowBaggage.set(baseCtx, baggageValues);
            },

            getWorkflowHeaders(): Record<string, string> {
              const headers: Record<string, string> = {};
              const ctx = context.active();
              propagation.inject(ctx, headers);
              return headers;
            },

            recordStepProgress(stepName: string, stepIndex: number): void {
              baggageValues.stepName = stepName;
              baggageValues.stepIndex = stepIndex;
              WorkflowBaggage.set(baseCtx, baggageValues);

              baseCtx.addEvent('workflow.step_progress', {
                'workflow.step.name': stepName,
                'workflow.step.index': stepIndex,
              });
            },
          };

          // Call onStart callback
          config.onStart?.(workflowCtx);

          // Add start event
          baseCtx.addEvent('workflow.started', {
            'workflow.id': workflowId,
            'workflow.name': config.name,
          });

          try {
            const userFn = fnFactory(workflowCtx);
            const result = await userFn(...args);

            // Call onComplete callback
            config.onComplete?.(workflowCtx, result);

            // Add completion event
            baseCtx.addEvent('workflow.completed', {
              'workflow.id': workflowId,
            });

            return result;
          } catch (error) {
            // Call onError callback
            config.onError?.(workflowCtx, error as Error);

            // Add error event
            baseCtx.addEvent('workflow.failed', {
              'workflow.id': workflowId,
              'workflow.error': (error as Error).message,
            });

            throw error;
          }
        };
      },
    );
  };
}

// ============================================================================
// Distributed Step Tracer
// ============================================================================

/**
 * Create a traced distributed workflow step
 *
 * Use in downstream services to trace steps that are part of a distributed workflow.
 * Automatically extracts workflow baggage from the current context.
 *
 * @param config - Step configuration
 * @returns Factory function for the step handler
 *
 * @example Consumer in downstream service
 * ```typescript
 * export const processInventory = traceConsumer({
 *   system: 'kafka',
 *   destination: 'inventory-requests',
 *   extractBaggage: true,  // Extracts workflow.* from headers
 * })(ctx => {
 *   // Wrap inner logic with traceDistributedStep
 *   return traceDistributedStep({
 *     name: 'ReserveInventory',
 *   })(stepCtx => async (message) => {
 *     console.log(`Processing workflow ${stepCtx.workflowId}`);
 *     await reserveItems(message.items);
 *   })(message);
 * });
 * ```
 *
 * @example Standalone step handler
 * ```typescript
 * export const reserveInventory = traceDistributedStep({
 *   name: 'ReserveInventory',
 *   idempotent: true,
 * })(ctx => async (request: InventoryRequest) => {
 *   if (ctx.workflowId) {
 *     console.log(`Part of workflow ${ctx.workflowId}, step ${ctx.stepIndex}`);
 *   }
 *   return await inventoryService.reserve(request.items);
 * });
 * ```
 */
export function traceDistributedStep<TArgs extends unknown[], TReturn>(
  config: DistributedStepConfig,
) {
  const spanName = `workflow.step.${config.name}`;

  return (
    fnFactory: (
      ctx: DistributedStepContext,
    ) => (...args: TArgs) => Promise<TReturn>,
  ): ((...args: TArgs) => Promise<TReturn>) => {
    return trace<TArgs, TReturn>(
      { name: spanName, spanKind: SpanKind.INTERNAL },
      (baseCtx) => {
        return async (...args: TArgs) => {
          // Extract workflow baggage
          let baggageValues: WorkflowBaggageValues | null = null;

          const extractBaggage = config.extractBaggage ?? true;
          if (typeof extractBaggage === 'function') {
            baggageValues = extractBaggage(args);
          } else if (extractBaggage) {
            // Read from current context
            const extracted = WorkflowBaggage.get(baseCtx);
            if (extracted.workflowId && extracted.workflowName) {
              baggageValues = extracted as WorkflowBaggageValues;
            }
          }

          // Determine step index
          // If explicit stepIndex provided in config, use it
          // Otherwise, auto-increment from baggage if available
          let stepIndex: number | null;
          if (config.stepIndex !== undefined) {
            stepIndex = config.stepIndex;
          } else if (baggageValues?.stepIndex === undefined) {
            stepIndex = null;
          } else {
            // Auto-increment from previous step
            stepIndex = baggageValues.stepIndex + 1;
          }

          // Update baggage with current step
          if (baggageValues) {
            baggageValues.stepName = config.name;
            if (stepIndex !== null) {
              baggageValues.stepIndex = stepIndex;
            }
            WorkflowBaggage.set(baseCtx, baggageValues);
          }

          // Set span attributes
          baseCtx.setAttribute('workflow.step.name', config.name);
          if (stepIndex !== null) {
            baseCtx.setAttribute('workflow.step.index', stepIndex);
          }
          if (config.idempotent !== undefined) {
            baseCtx.setAttribute('workflow.step.idempotent', config.idempotent);
          }
          if (config.isCompensation) {
            baseCtx.setAttribute('workflow.step.is_compensation', true);
          }

          // Add workflow context attributes if available
          if (baggageValues) {
            baseCtx.setAttribute('workflow.id', baggageValues.workflowId);
            baseCtx.setAttribute('workflow.name', baggageValues.workflowName);
            if (baggageValues.workflowVersion) {
              baseCtx.setAttribute(
                'workflow.version',
                baggageValues.workflowVersion,
              );
            }
            if (baggageValues.totalSteps) {
              baseCtx.setAttribute(
                'workflow.total_steps',
                baggageValues.totalSteps,
              );
            }
          }

          // Apply custom attributes
          if (config.attributes) {
            for (const [key, value] of Object.entries(config.attributes)) {
              baseCtx.setAttribute(key, value);
            }
          }

          // Compensation data storage
          let compensationData: Record<string, unknown> | undefined;

          // Create extended context
          const stepCtx: DistributedStepContext = {
            ...baseCtx,
            workflowId: baggageValues?.workflowId ?? null,
            workflowName: baggageValues?.workflowName ?? null,
            stepName: config.name,
            stepIndex,
            isCompensation: config.isCompensation ?? false,

            getWorkflowBaggage(): WorkflowBaggageValues | null {
              return baggageValues ? { ...baggageValues } : null;
            },

            updateWorkflowBaggage(
              values: Partial<WorkflowBaggageValues>,
            ): void {
              if (baggageValues) {
                Object.assign(baggageValues, values);
                WorkflowBaggage.set(baseCtx, baggageValues);
              }
            },

            getWorkflowHeaders(): Record<string, string> {
              const headers: Record<string, string> = {};
              const ctx = context.active();
              propagation.inject(ctx, headers);
              return headers;
            },

            requiresCompensation(data?: Record<string, unknown>): void {
              compensationData = data;
              baseCtx.setAttribute('workflow.step.requires_compensation', true);
              baseCtx.addEvent('workflow.step.compensation_registered', {
                'workflow.step.name': config.name,
                ...(data && {
                  'workflow.step.compensation_data': JSON.stringify(data),
                }),
              });
            },
          };

          // Call onStart callback
          config.onStart?.(stepCtx);

          // Add start event
          baseCtx.addEvent('workflow.step.started', {
            'workflow.step.name': config.name,
            ...(baggageValues && { 'workflow.id': baggageValues.workflowId }),
          });

          try {
            const userFn = fnFactory(stepCtx);
            const result = await userFn(...args);

            // Call onComplete callback
            config.onComplete?.(stepCtx, result);

            // Add completion event
            baseCtx.addEvent('workflow.step.completed', {
              'workflow.step.name': config.name,
            });

            return result;
          } catch (error) {
            // Call onError callback
            config.onError?.(stepCtx, error as Error);

            // Add error event with compensation info if registered
            baseCtx.addEvent('workflow.step.failed', {
              'workflow.step.name': config.name,
              'workflow.step.error': (error as Error).message,
              ...(compensationData && {
                'workflow.step.requires_compensation': true,
              }),
            });

            throw error;
          }
        };
      },
    );
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a unique workflow ID
 *
 * @param prefix - Optional prefix for the ID
 * @returns A unique workflow ID
 *
 * @example
 * ```typescript
 * const workflowId = generateWorkflowId('order'); // "order-abc123def456"
 * ```
 */
export function generateWorkflowId(prefix?: string): string {
  const random = Math.random().toString(36).slice(2, 15);
  const timestamp = Date.now().toString(36);
  const id = `${timestamp}-${random}`;
  return prefix ? `${prefix}-${id}` : id;
}

/**
 * Check if the current context is part of a distributed workflow
 *
 * @param ctx - The trace context
 * @returns True if workflow baggage is present
 */
export function isInDistributedWorkflow(ctx: TraceContext): boolean {
  const baggage = WorkflowBaggage.get(ctx);
  return !!(baggage.workflowId && baggage.workflowName);
}

/**
 * Get workflow progress information
 *
 * @param ctx - The trace context
 * @returns Progress info or null if not in a workflow
 */
export function getWorkflowProgress(ctx: TraceContext): {
  workflowId: string;
  workflowName: string;
  currentStep: string | null;
  currentStepIndex: number | null;
  totalSteps: number | null;
  percentComplete: number | null;
} | null {
  const baggage = WorkflowBaggage.get(ctx);
  if (!baggage.workflowId || !baggage.workflowName) {
    return null;
  }

  const percentComplete =
    baggage.totalSteps && baggage.stepIndex !== undefined
      ? Math.round(((baggage.stepIndex + 1) / baggage.totalSteps) * 100)
      : null;

  return {
    workflowId: baggage.workflowId,
    workflowName: baggage.workflowName,
    currentStep: baggage.stepName ?? null,
    currentStepIndex: baggage.stepIndex ?? null,
    totalSteps: baggage.totalSteps ?? null,
    percentComplete,
  };
}

/**
 * Create workflow correlation headers for manual propagation
 *
 * Use when you need to manually add workflow context to outgoing requests.
 *
 * @param values - Workflow baggage values
 * @returns Headers object with workflow baggage
 *
 * @example
 * ```typescript
 * const headers = createWorkflowHeaders({
 *   workflowId: 'order-123',
 *   workflowName: 'OrderFulfillment',
 *   stepIndex: 2,
 * });
 *
 * await fetch('/api/inventory', { headers });
 * ```
 */
export function createWorkflowHeaders(
  values: Partial<WorkflowBaggageValues>,
): Record<string, string> {
  const headers: Record<string, string> = {};

  // Build baggage string
  const baggageEntries: string[] = [];

  if (values.workflowId) {
    baggageEntries.push(
      `workflow.workflowId=${encodeURIComponent(values.workflowId)}`,
    );
  }
  if (values.workflowName) {
    baggageEntries.push(
      `workflow.workflowName=${encodeURIComponent(values.workflowName)}`,
    );
  }
  if (values.workflowVersion) {
    baggageEntries.push(
      `workflow.workflowVersion=${encodeURIComponent(values.workflowVersion)}`,
    );
  }
  if (values.stepName) {
    baggageEntries.push(
      `workflow.stepName=${encodeURIComponent(values.stepName)}`,
    );
  }
  if (values.stepIndex !== undefined) {
    baggageEntries.push(`workflow.stepIndex=${values.stepIndex}`);
  }
  if (values.totalSteps !== undefined) {
    baggageEntries.push(`workflow.totalSteps=${values.totalSteps}`);
  }
  if (values.priority) {
    baggageEntries.push(`workflow.priority=${values.priority}`);
  }
  if (values.correlationId) {
    baggageEntries.push(
      `workflow.correlationId=${encodeURIComponent(values.correlationId)}`,
    );
  }
  if (values.parentWorkflowId) {
    baggageEntries.push(
      `workflow.parentWorkflowId=${encodeURIComponent(values.parentWorkflowId)}`,
    );
  }
  if (values.initiatedBy) {
    baggageEntries.push(
      `workflow.initiatedBy=${encodeURIComponent(values.initiatedBy)}`,
    );
  }
  if (values.startedAt) {
    baggageEntries.push(
      `workflow.startedAt=${encodeURIComponent(values.startedAt)}`,
    );
  }

  if (baggageEntries.length > 0) {
    headers['baggage'] = baggageEntries.join(',');
  }

  return headers;
}

/**
 * Parse workflow context from baggage header
 *
 * @param baggageHeader - The baggage header value
 * @returns Parsed workflow values or null
 */
export function parseWorkflowFromBaggage(
  baggageHeader: string,
): Partial<WorkflowBaggageValues> | null {
  if (!baggageHeader) {
    return null;
  }

  const values: Partial<WorkflowBaggageValues> = {};
  const entries = baggageHeader.split(',');

  for (const entry of entries) {
    const [key, value] = entry.trim().split('=');
    if (!key || !value) continue;

    const decodedValue = decodeURIComponent(value);

    switch (key) {
      case 'workflow.workflowId': {
        values.workflowId = decodedValue;
        break;
      }
      case 'workflow.workflowName': {
        values.workflowName = decodedValue;
        break;
      }
      case 'workflow.workflowVersion': {
        values.workflowVersion = decodedValue;
        break;
      }
      case 'workflow.stepName': {
        values.stepName = decodedValue;
        break;
      }
      case 'workflow.stepIndex': {
        values.stepIndex = Number.parseInt(decodedValue, 10);
        break;
      }
      case 'workflow.totalSteps': {
        values.totalSteps = Number.parseInt(decodedValue, 10);
        break;
      }
      case 'workflow.priority': {
        values.priority = decodedValue as WorkflowBaggageValues['priority'];
        break;
      }
      case 'workflow.correlationId': {
        values.correlationId = decodedValue;
        break;
      }
      case 'workflow.parentWorkflowId': {
        values.parentWorkflowId = decodedValue;
        break;
      }
      case 'workflow.initiatedBy': {
        values.initiatedBy = decodedValue;
        break;
      }
      case 'workflow.startedAt': {
        values.startedAt = decodedValue;
        break;
      }
    }
  }

  return Object.keys(values).length > 0 ? values : null;
}
