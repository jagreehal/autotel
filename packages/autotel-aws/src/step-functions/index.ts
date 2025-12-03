/**
 * Step Functions instrumentation
 *
 * Provides semantic helpers for tracing AWS Step Functions operations
 * with context propagation for distributed tracing across state machines.
 *
 * @example Start workflow with trace context
 * ```typescript
 * import { StepFunctionsExecutor, injectTraceContext } from 'autotel-aws/step-functions';
 * import { SFNClient } from '@aws-sdk/client-sfn';
 *
 * const sfn = new SFNClient({});
 * const executor = new StepFunctionsExecutor(sfn, {
 *   stateMachineArn: 'arn:aws:states:us-east-1:123456789:stateMachine:OrderProcessor'
 * });
 *
 * // Start execution with automatic trace context injection
 * const result = await executor.startExecution({
 *   input: { orderId: '123', items: [...] },
 *   name: 'order-123-execution'
 * });
 * ```
 *
 * @example Extract context in Lambda invoked by Step Functions
 * ```typescript
 * import { extractStepFunctionsContext } from 'autotel-aws/step-functions';
 * import { wrapHandler } from 'autotel-aws/lambda';
 *
 * export const handler = wrapHandler(async (event) => {
 *   // Extract trace context from Step Functions input
 *   const parentContext = extractStepFunctionsContext(event);
 *
 *   // Process the order (without the trace context fields)
 *   const { orderId, items } = event;
 *   await processOrder(orderId, items);
 *
 *   return { status: 'completed' };
 * });
 * ```
 *
 * @example Activity worker with context propagation
 * ```typescript
 * import { StepFunctionsActivityWorker } from 'autotel-aws/step-functions';
 *
 * const worker = new StepFunctionsActivityWorker(sfn, {
 *   activityArn: 'arn:aws:states:us-east-1:123456789:activity:ProcessPayment'
 * });
 *
 * // Worker extracts trace context and creates child spans
 * await worker.poll(async (input, taskToken, ctx) => {
 *   ctx.setAttribute('payment.amount', input.amount);
 *   const result = await processPayment(input);
 *   return result;
 * });
 * ```
 */

import { trace, type TraceContext } from 'autotel';
import { context, propagation, SpanStatusCode } from '@opentelemetry/api';
import type { SpanContext } from '@opentelemetry/api';
import { buildStepFunctionsAttributes } from '../attributes';
import { wrapSDKClient } from '../common/sdk-wrapper';

// ============================================================================
// Types
// ============================================================================

/**
 * Step Functions operation configuration
 */
export interface TraceStepFunctionConfig {
  /**
   * State machine ARN
   * Sets `aws.stepfunctions.state_machine_arn` attribute.
   */
  stateMachineArn: string;

  /**
   * Operation type
   * Used to generate the span name: `stepfunctions.{operation}`
   * @default 'execute'
   */
  operation?:
    | 'StartExecution'
    | 'DescribeExecution'
    | 'StopExecution'
    | 'ListExecutions'
    | 'SendTaskSuccess'
    | 'SendTaskFailure'
    | 'execute'; // Legacy alias for StartExecution
}

/**
 * Configuration for StepFunctionsExecutor
 */
export interface StepFunctionsExecutorConfig {
  /**
   * State machine ARN
   */
  stateMachineArn: string;

  /**
   * Inject W3C Trace Context into execution input
   * @default true
   */
  injectTraceContext?: boolean;

  /**
   * Optional service name for tracing
   */
  service?: string;
}

/**
 * Execution input with optional trace context
 */
export interface ExecutionInput<T = Record<string, unknown>> {
  /**
   * The input data for the execution
   */
  input: T;

  /**
   * Optional execution name (must be unique within 90 days)
   */
  name?: string;

  /**
   * Optional trace ID for idempotency
   */
  traceHeader?: string;
}

/**
 * Configuration for StepFunctionsActivityWorker
 */
export interface StepFunctionsActivityWorkerConfig {
  /**
   * Activity ARN
   */
  activityArn: string;

  /**
   * Worker name for identification
   */
  workerName?: string;

  /**
   * Extract trace context from activity input
   * @default true
   */
  extractTraceContext?: boolean;

  /**
   * Optional service name for tracing
   */
  service?: string;
}

/**
 * Trace context fields injected into Step Functions input
 */
interface TraceContextFields {
  _traceContext?: {
    traceparent: string;
    tracestate?: string;
    baggage?: string;
  };
}

// ============================================================================
// Context Propagation Helpers
// ============================================================================

/**
 * Inject W3C Trace Context into Step Functions execution input
 *
 * Adds `_traceContext` field with traceparent, tracestate, and baggage.
 * This enables distributed tracing across Step Functions executions
 * and Lambda functions invoked by the state machine.
 *
 * @param input - The original execution input
 * @returns Input with trace context injected
 *
 * @example
 * ```typescript
 * const input = { orderId: '123', items: [...] };
 * const inputWithContext = injectTraceContext(input);
 * // { orderId: '123', items: [...], _traceContext: { traceparent: '...' } }
 *
 * await sfn.send(new StartExecutionCommand({
 *   stateMachineArn: 'arn:...',
 *   input: JSON.stringify(inputWithContext)
 * }));
 * ```
 */
export function injectTraceContext<T extends Record<string, unknown>>(
  input: T,
): T & TraceContextFields {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);

  if (!carrier.traceparent) {
    return input;
  }

  return {
    ...input,
    _traceContext: {
      traceparent: carrier.traceparent,
      ...(carrier.tracestate && { tracestate: carrier.tracestate }),
      ...(carrier.baggage && { baggage: carrier.baggage }),
    },
  };
}

/**
 * Extract W3C Trace Context from Step Functions input
 *
 * Extracts the `_traceContext` field added by injectTraceContext.
 * Returns the SpanContext if present, or undefined.
 *
 * @param input - Step Functions input (event in Lambda handler)
 * @returns SpanContext if trace context was found, undefined otherwise
 *
 * @example
 * ```typescript
 * // In a Lambda invoked by Step Functions
 * export const handler = async (event) => {
 *   const parentContext = extractStepFunctionsContext(event);
 *   // Use parentContext to link traces...
 *
 *   // Access data without trace context
 *   const { orderId, items } = stripTraceContext(event);
 * };
 * ```
 */
export function extractStepFunctionsContext(
  input: unknown,
): SpanContext | undefined {
  if (
    typeof input !== 'object' ||
    input === null ||
    !('_traceContext' in input)
  ) {
    return undefined;
  }

  const traceContext = (input as TraceContextFields)._traceContext;
  if (!traceContext?.traceparent) {
    return undefined;
  }

  // Use W3C Trace Context propagator to extract
  const carrier: Record<string, string> = {
    traceparent: traceContext.traceparent,
    ...(traceContext.tracestate && { tracestate: traceContext.tracestate }),
    ...(traceContext.baggage && { baggage: traceContext.baggage }),
  };

  const extractedContext = propagation.extract(context.active(), carrier);
  const span = extractedContext.getValue(Symbol.for('OpenTelemetry Context Key SPAN'));

  // Handle both Span and SpanContext
  if (span && typeof span === 'object') {
    if ('spanContext' in span && typeof span.spanContext === 'function') {
      return span.spanContext() as SpanContext;
    }
    // Might already be a SpanContext
    if ('traceId' in span && 'spanId' in span) {
      return span as SpanContext;
    }
  }

  return undefined;
}

/**
 * Strip trace context fields from Step Functions input
 *
 * Returns the input without `_traceContext` field for cleaner processing.
 *
 * @param input - Step Functions input with optional trace context
 * @returns Input without trace context fields
 *
 * @example
 * ```typescript
 * const event = { orderId: '123', _traceContext: { ... } };
 * const cleanInput = stripTraceContext(event);
 * // { orderId: '123' }
 * ```
 */
export function stripTraceContext<T extends Record<string, unknown>>(
  input: T,
): Omit<T, '_traceContext'> {
  const { _traceContext: _, ...rest } = input as T & TraceContextFields;
  return rest as Omit<T, '_traceContext'>;
}

// ============================================================================
// Trace Helper (Original API)
// ============================================================================

/**
 * Trace Step Functions operations
 *
 * Creates a traced function that automatically sets Step Functions attributes.
 *
 * @param config - Step Functions operation configuration
 * @returns A higher-order function that wraps your Step Functions operation with tracing
 *
 * @remarks
 * Semantic attributes set automatically:
 * - `aws.stepfunctions.state_machine_arn` - State machine ARN
 *
 * Additional attributes you should set in your handler:
 * - `aws.stepfunctions.execution_arn` - Execution ARN
 * - `aws.stepfunctions.execution_name` - Execution name
 *
 * @example
 * ```typescript
 * export const startWorkflow = traceStepFunction({
 *   stateMachineArn: 'arn:aws:states:us-east-1:123456789:stateMachine:OrderProcessor',
 *   operation: 'StartExecution'
 * })(ctx => async (input: object, executionName?: string) => {
 *   const result = await sfn.send(new StartExecutionCommand({
 *     stateMachineArn: 'arn:aws:states:...',
 *     input: JSON.stringify(injectTraceContext(input)),
 *     name: executionName
 *   }));
 *
 *   ctx.setAttribute('aws.stepfunctions.execution_arn', result.executionArn ?? '');
 *   return result;
 * });
 * ```
 */
export function traceStepFunction(config: TraceStepFunctionConfig) {
  const operation = config.operation ?? 'execute';

  return function wrapper<TArgs extends unknown[], TReturn>(
    fn: (ctx: TraceContext) => (...args: TArgs) => Promise<TReturn>,
  ): (...args: TArgs) => Promise<TReturn> {
    // Use autotel's trace() which properly handles the factory pattern
    return trace(
      `stepfunctions.${operation}`,
      (ctx: TraceContext) =>
        async (...args: TArgs): Promise<TReturn> => {
          // Set Step Functions attributes
          ctx.setAttributes(
            buildStepFunctionsAttributes({
              stateMachineArn: config.stateMachineArn,
            }),
          );

          // Get the user's handler and execute with forwarded arguments
          const handler = fn(ctx);
          return handler(...args);
        },
    );
  };
}

// ============================================================================
// StepFunctionsExecutor Class
// ============================================================================

/**
 * Step Functions Executor with automatic trace context injection
 *
 * Wraps an SFN client to automatically:
 * - Create spans for all operations
 * - Inject W3C Trace Context into execution input
 * - Set proper semantic attributes
 *
 * @example Basic usage
 * ```typescript
 * import { StepFunctionsExecutor } from 'autotel-aws/step-functions';
 * import { SFNClient } from '@aws-sdk/client-sfn';
 *
 * const sfn = new SFNClient({ region: 'us-east-1' });
 * const executor = new StepFunctionsExecutor(sfn, {
 *   stateMachineArn: 'arn:aws:states:us-east-1:123456789:stateMachine:OrderProcessor'
 * });
 *
 * // Start execution with automatic trace context
 * const result = await executor.startExecution({
 *   input: { orderId: '123', items: ['item1', 'item2'] },
 *   name: 'order-123-execution'
 * });
 *
 * console.log('Execution ARN:', result.executionArn);
 * ```
 *
 * @example Express workflow (sync execution)
 * ```typescript
 * // Express workflows return synchronously
 * const result = await executor.startSyncExecution({
 *   input: { orderId: '123' }
 * });
 *
 * if (result.status === 'SUCCEEDED') {
 *   const output = JSON.parse(result.output || '{}');
 *   console.log('Workflow output:', output);
 * }
 * ```
 */
export class StepFunctionsExecutor<
   
  TClient extends { send: (command: any) => Promise<any> } = any,
> {
  private client: TClient;
  private config: Required<Pick<StepFunctionsExecutorConfig, 'stateMachineArn'>> &
    StepFunctionsExecutorConfig;
  private stateMachineName: string;

  constructor(client: TClient, config: StepFunctionsExecutorConfig) {
    this.client = wrapSDKClient(client as any, config.service) as TClient;
    this.config = {
      injectTraceContext: true,
      ...config,
    };
    // Extract state machine name from ARN (last segment)
    this.stateMachineName = config.stateMachineArn.split(':').pop() || 'unknown';
  }

  /**
   * Start a new execution of the state machine
   *
   * @param execution - Execution input and optional name
   * @returns Promise with execution ARN and start date
   */
  async startExecution<T extends Record<string, unknown>>(
    execution: ExecutionInput<T>,
  ): Promise<{
    executionArn?: string;
    startDate?: Date;
  }> {
    return trace(`stepfunctions.StartExecution`, async (ctx: TraceContext) => {
      ctx.setAttributes(
        buildStepFunctionsAttributes({
          stateMachineArn: this.config.stateMachineArn,
        }),
      );
      ctx.setAttribute('aws.stepfunctions.state_machine_name', this.stateMachineName);

      if (execution.name) {
        ctx.setAttribute('aws.stepfunctions.execution_name', execution.name);
      }

      // Optionally inject trace context
      const inputData = this.config.injectTraceContext
        ? injectTraceContext(execution.input)
        : execution.input;

      const input = {
        stateMachineArn: this.config.stateMachineArn,
        input: JSON.stringify(inputData),
        name: execution.name,
        traceHeader: execution.traceHeader,
      };

      try {
        const { StartExecutionCommand } = await import('@aws-sdk/client-sfn');
        const result = await this.client.send(new StartExecutionCommand(input));

        if (result.executionArn) {
          ctx.setAttribute('aws.stepfunctions.execution_arn', result.executionArn);
        }

        ctx.setStatus({ code: SpanStatusCode.OK });

        return {
          executionArn: result.executionArn,
          startDate: result.startDate,
        };
      } catch (error) {
        ctx.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'StartExecution failed',
        });
        throw error;
      }
    });
  }

  /**
   * Start a synchronous execution (Express workflows only)
   *
   * @param execution - Execution input and optional name
   * @returns Promise with execution result including output
   */
  async startSyncExecution<T extends Record<string, unknown>>(
    execution: ExecutionInput<T>,
  ): Promise<{
    executionArn?: string;
    status?: 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT';
    output?: string;
    error?: string;
    cause?: string;
    billingDetails?: {
      billedMemoryUsedInMB?: number;
      billedDurationInMilliseconds?: number;
    };
  }> {
    return trace(`stepfunctions.StartSyncExecution`, async (ctx: TraceContext) => {
      ctx.setAttributes(
        buildStepFunctionsAttributes({
          stateMachineArn: this.config.stateMachineArn,
        }),
      );
      ctx.setAttribute('aws.stepfunctions.state_machine_name', this.stateMachineName);
      ctx.setAttribute('aws.stepfunctions.execution_type', 'express');

      if (execution.name) {
        ctx.setAttribute('aws.stepfunctions.execution_name', execution.name);
      }

      // Optionally inject trace context
      const inputData = this.config.injectTraceContext
        ? injectTraceContext(execution.input)
        : execution.input;

      const input = {
        stateMachineArn: this.config.stateMachineArn,
        input: JSON.stringify(inputData),
        name: execution.name,
        traceHeader: execution.traceHeader,
      };

      try {
        const { StartSyncExecutionCommand } = await import('@aws-sdk/client-sfn');
        const result = await this.client.send(new StartSyncExecutionCommand(input));

        if (result.executionArn) {
          ctx.setAttribute('aws.stepfunctions.execution_arn', result.executionArn);
        }
        if (result.status) {
          ctx.setAttribute('aws.stepfunctions.execution_status', result.status);
        }

        if (result.status === 'FAILED' || result.status === 'TIMED_OUT') {
          ctx.setStatus({
            code: SpanStatusCode.ERROR,
            message: result.error || result.status,
          });
        } else {
          ctx.setStatus({ code: SpanStatusCode.OK });
        }

        return {
          executionArn: result.executionArn,
          status: result.status as 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | undefined,
          output: result.output,
          error: result.error,
          cause: result.cause,
          billingDetails: result.billingDetails
            ? {
                billedMemoryUsedInMB: result.billingDetails.billedMemoryUsedInMB,
                billedDurationInMilliseconds:
                  result.billingDetails.billedDurationInMilliseconds,
              }
            : undefined,
        };
      } catch (error) {
        ctx.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'StartSyncExecution failed',
        });
        throw error;
      }
    });
  }

  /**
   * Describe an execution
   *
   * @param executionArn - ARN of the execution to describe
   * @returns Promise with execution details
   */
  async describeExecution(executionArn: string): Promise<{
    executionArn?: string;
    stateMachineArn?: string;
    name?: string;
    status?: string;
    startDate?: Date;
    stopDate?: Date;
    input?: string;
    output?: string;
    error?: string;
    cause?: string;
  }> {
    return trace(`stepfunctions.DescribeExecution`, async (ctx: TraceContext) => {
      ctx.setAttributes(
        buildStepFunctionsAttributes({
          stateMachineArn: this.config.stateMachineArn,
        }),
      );
      ctx.setAttribute('aws.stepfunctions.execution_arn', executionArn);

      try {
        const { DescribeExecutionCommand } = await import('@aws-sdk/client-sfn');
        const result = await this.client.send(
          new DescribeExecutionCommand({ executionArn }),
        );

        if (result.status) {
          ctx.setAttribute('aws.stepfunctions.execution_status', result.status);
        }

        ctx.setStatus({ code: SpanStatusCode.OK });

        return {
          executionArn: result.executionArn,
          stateMachineArn: result.stateMachineArn,
          name: result.name,
          status: result.status,
          startDate: result.startDate,
          stopDate: result.stopDate,
          input: result.input,
          output: result.output,
          error: result.error,
          cause: result.cause,
        };
      } catch (error) {
        ctx.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'DescribeExecution failed',
        });
        throw error;
      }
    });
  }

  /**
   * Stop an execution
   *
   * @param executionArn - ARN of the execution to stop
   * @param options - Optional error and cause for the stop
   * @returns Promise with stop date
   */
  async stopExecution(
    executionArn: string,
    options?: { error?: string; cause?: string },
  ): Promise<{ stopDate?: Date }> {
    return trace(`stepfunctions.StopExecution`, async (ctx: TraceContext) => {
      ctx.setAttributes(
        buildStepFunctionsAttributes({
          stateMachineArn: this.config.stateMachineArn,
        }),
      );
      ctx.setAttribute('aws.stepfunctions.execution_arn', executionArn);

      try {
        const { StopExecutionCommand } = await import('@aws-sdk/client-sfn');
        const result = await this.client.send(
          new StopExecutionCommand({
            executionArn,
            error: options?.error,
            cause: options?.cause,
          }),
        );

        ctx.setStatus({ code: SpanStatusCode.OK });

        return { stopDate: result.stopDate };
      } catch (error) {
        ctx.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'StopExecution failed',
        });
        throw error;
      }
    });
  }
}

// ============================================================================
// StepFunctionsActivityWorker Class
// ============================================================================

/**
 * Step Functions Activity Worker with trace context extraction
 *
 * Polls for activity tasks and processes them with automatic tracing.
 * Extracts trace context from task input for distributed tracing.
 *
 * @example Basic activity worker
 * ```typescript
 * import { StepFunctionsActivityWorker } from 'autotel-aws/step-functions';
 * import { SFNClient } from '@aws-sdk/client-sfn';
 *
 * const sfn = new SFNClient({ region: 'us-east-1' });
 * const worker = new StepFunctionsActivityWorker(sfn, {
 *   activityArn: 'arn:aws:states:us-east-1:123456789:activity:ProcessPayment',
 *   workerName: 'payment-worker-1'
 * });
 *
 * // Process tasks with automatic tracing
 * await worker.poll(async (input, taskToken, ctx) => {
 *   ctx.setAttribute('payment.amount', input.amount);
 *   ctx.setAttribute('payment.currency', input.currency);
 *
 *   const result = await processPayment(input);
 *
 *   ctx.setAttribute('payment.status', result.status);
 *   return result;
 * });
 * ```
 *
 * @example Continuous polling with error handling
 * ```typescript
 * async function runWorker() {
 *   while (true) {
 *     try {
 *       await worker.poll(async (input, taskToken, ctx) => {
 *         return await processTask(input);
 *       });
 *     } catch (error) {
 *       console.error('Worker error:', error);
 *       // Brief pause before retrying
 *       await new Promise(resolve => setTimeout(resolve, 1000));
 *     }
 *   }
 * }
 * ```
 */
export class StepFunctionsActivityWorker<
   
  TClient extends { send: (command: any) => Promise<any> } = any,
> {
  private client: TClient;
  private config: Required<Pick<StepFunctionsActivityWorkerConfig, 'activityArn'>> &
    StepFunctionsActivityWorkerConfig;
  private activityName: string;

  constructor(client: TClient, config: StepFunctionsActivityWorkerConfig) {
    this.client = wrapSDKClient(client as any, config.service) as TClient;
    this.config = {
      extractTraceContext: true,
      ...config,
    };
    // Extract activity name from ARN
    this.activityName = config.activityArn.split(':').pop() || 'unknown';
  }

  /**
   * Poll for an activity task and process it
   *
   * @param processor - Function to process the task input
   * @returns Promise that resolves when the task is processed
   */
  async poll<TInput extends Record<string, unknown>, TOutput>(
    processor: (
      input: TInput,
      taskToken: string,
      ctx: TraceContext,
    ) => Promise<TOutput>,
  ): Promise<void> {
    return trace(`stepfunctions.activity.poll`, async (ctx: TraceContext) => {
      ctx.setAttribute('aws.stepfunctions.activity_arn', this.config.activityArn);
      ctx.setAttribute('aws.stepfunctions.activity_name', this.activityName);

      if (this.config.workerName) {
        ctx.setAttribute('aws.stepfunctions.worker_name', this.config.workerName);
      }

      try {
        // Poll for task
        const { GetActivityTaskCommand } = await import('@aws-sdk/client-sfn');
        const task = await this.client.send(
          new GetActivityTaskCommand({
            activityArn: this.config.activityArn,
            workerName: this.config.workerName,
          }),
        );

        if (!task.taskToken || !task.input) {
          // No task available (timeout)
          ctx.setAttribute('aws.stepfunctions.activity_task_received', false);
          ctx.setStatus({ code: SpanStatusCode.OK });
          return;
        }

        ctx.setAttribute('aws.stepfunctions.activity_task_received', true);

        // Parse input
        const rawInput = JSON.parse(task.input) as TInput & TraceContextFields;

        // Extract trace context if enabled
        if (this.config.extractTraceContext) {
          const parentContext = extractStepFunctionsContext(rawInput);
          if (parentContext) {
            ctx.setAttribute('aws.stepfunctions.trace_context_extracted', true);
          }
        }

        // Strip trace context from input
        const cleanInput = stripTraceContext(rawInput) as TInput;

        // Process the task
        const output = await processor(cleanInput, task.taskToken, ctx);

        // Send success
        const { SendTaskSuccessCommand } = await import('@aws-sdk/client-sfn');
        await this.client.send(
          new SendTaskSuccessCommand({
            taskToken: task.taskToken,
            output: JSON.stringify(output),
          }),
        );

        ctx.setStatus({ code: SpanStatusCode.OK });
      } catch (error) {
        ctx.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'Activity processing failed',
        });

        // If we have a task token, send failure
        // Note: In a real implementation, you'd want to track the token
        // This is simplified for the example

        throw error;
      }
    });
  }

  /**
   * Send a task heartbeat
   *
   * For long-running activities, send heartbeats to prevent timeout.
   *
   * @param taskToken - The task token from GetActivityTask
   */
  async sendHeartbeat(taskToken: string): Promise<void> {
    return trace(`stepfunctions.SendTaskHeartbeat`, async (ctx: TraceContext) => {
      ctx.setAttribute('aws.stepfunctions.activity_arn', this.config.activityArn);

      try {
        const { SendTaskHeartbeatCommand } = await import('@aws-sdk/client-sfn');
        await this.client.send(new SendTaskHeartbeatCommand({ taskToken }));

        ctx.setStatus({ code: SpanStatusCode.OK });
      } catch (error) {
        ctx.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'SendTaskHeartbeat failed',
        });
        throw error;
      }
    });
  }

  /**
   * Send task failure
   *
   * @param taskToken - The task token from GetActivityTask
   * @param error - Error code
   * @param cause - Error cause description
   */
  async sendFailure(
    taskToken: string,
    error: string,
    cause?: string,
  ): Promise<void> {
    return trace(`stepfunctions.SendTaskFailure`, async (ctx: TraceContext) => {
      ctx.setAttribute('aws.stepfunctions.activity_arn', this.config.activityArn);
      ctx.setAttribute('aws.stepfunctions.task_error', error);

      try {
        const { SendTaskFailureCommand } = await import('@aws-sdk/client-sfn');
        await this.client.send(
          new SendTaskFailureCommand({
            taskToken,
            error,
            cause,
          }),
        );

        ctx.setStatus({ code: SpanStatusCode.OK });
      } catch (error_) {
        ctx.setStatus({
          code: SpanStatusCode.ERROR,
          message: error_ instanceof Error ? error_.message : 'SendTaskFailure failed',
        });
        throw error_;
      }
    });
  }
}
