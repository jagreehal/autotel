/**
 * Cloudflare Workflows instrumentation for autotel-edge
 *
 * Instruments WorkflowEntrypoint classes to automatically trace workflow execution,
 * step operations, retries, and sleeps.
 *
 * Based on Cloudflare Workflows API:
 * https://developers.cloudflare.com/workflows/
 */

import {
  trace,
  context as api_context,
  SpanStatusCode,
  SpanKind,
} from '@opentelemetry/api';
import type { ConfigurationOption, WorkflowTrigger } from 'autotel-edge';
import { createInitialiser, setConfig, WorkerTracer } from 'autotel-edge';
import { wrap } from '../bindings/common';

/**
 * Workflow types matching the Cloudflare Workers Workflows API.
 * @see https://developers.cloudflare.com/workflows/
 */

interface WorkflowEvent<T = unknown> {
  payload: Readonly<T>;
  timestamp: Date;
  instanceId: string;
}

interface WorkflowStepConfig {
  retries?: {
    limit: number;
    delay?: string | number;
    backoff?: 'constant' | 'linear' | 'exponential';
  };
  timeout?: string | number;
}

interface WorkflowStep {
  do<T>(name: string, callback: () => Promise<T>): Promise<T>;
  do<T>(name: string, config: WorkflowStepConfig, callback: () => Promise<T>): Promise<T>;
  sleep(name: string, duration: string | number): Promise<void>;
  sleepUntil(name: string, timestamp: Date | number): Promise<void>;
}

type WorkflowRunFn = (
  event: Readonly<WorkflowEvent>,
  step: WorkflowStep,
) => Promise<unknown> | void;

/**
 * Track cold starts per Workflow class
 */
const coldStarts = new WeakMap<object, boolean>();

function isColdStart(workflowClass: object): boolean {
  if (!coldStarts.has(workflowClass)) {
    coldStarts.set(workflowClass, true);
    return true;
  }
  return false;
}

/**
 * Proxy the step object to instrument step.do() and step.sleep() calls
 */
function instrumentWorkflowStep(
  step: WorkflowStep,
  workflowName: string,
): WorkflowStep {
  const stepHandler: ProxyHandler<WorkflowStep> = {
    get(target, prop) {
      const value = Reflect.get(target, prop);

      // Instrument step.do() to create spans for each workflow step
      if (prop === 'do' && typeof value === 'function') {
        return new Proxy(value, {
          apply: (fnTarget, thisArg, args) => {
            const [stepName] = args as [string, ...unknown[]];

            const tracer = trace.getTracer('autotel-edge') as WorkerTracer;

            return tracer.startActiveSpan(
              `Workflow ${workflowName}: ${stepName}`,
              {
                kind: SpanKind.INTERNAL,
                attributes: {
                  'workflow.step.name': stepName,
                  'workflow.name': workflowName,
                },
              },
              async (span) => {
                try {
                  const result = await Reflect.apply(fnTarget, thisArg, args);
                  span.setStatus({ code: SpanStatusCode.OK });
                  return result;
                } catch (error) {
                  span.recordException(error as Error);
                  span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message:
                      error instanceof Error ? error.message : String(error),
                  });
                  throw error;
                } finally {
                  span.end();
                }
              },
            );
          },
        });
      }

      // Instrument step.sleep() to track workflow delays
      if (prop === 'sleep' && typeof value === 'function') {
        return new Proxy(value, {
          apply: (fnTarget, thisArg, args) => {
            const [sleepName, duration] = args as [string, string | number];

            const tracer = trace.getTracer('autotel-edge') as WorkerTracer;

            return tracer.startActiveSpan(
              `Workflow ${workflowName}: sleep ${sleepName}`,
              {
                kind: SpanKind.INTERNAL,
                attributes: {
                  'workflow.sleep.name': sleepName,
                  'workflow.sleep.duration': String(duration),
                  'workflow.name': workflowName,
                },
              },
              async (span) => {
                try {
                  const result = await Reflect.apply(fnTarget, thisArg, args);
                  span.setStatus({ code: SpanStatusCode.OK });
                  return result;
                } catch (error) {
                  span.recordException(error as Error);
                  span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message:
                      error instanceof Error ? error.message : String(error),
                  });
                  throw error;
                } finally {
                  span.end();
                }
              },
            );
          },
        });
      }

      // Pass through other step methods
      if (typeof value === 'function') {
        return value.bind(target);
      }

      return value;
    },
  };

  return wrap(step, stepHandler);
}

/**
 * Instrument a Workflow run method
 */
function instrumentWorkflowRun(
  runFn: WorkflowRunFn,
  workflowName: string,
  workflowClass: object,
): WorkflowRunFn {
  return async function instrumentedRun(
    this: unknown,
    event: Readonly<WorkflowEvent>,
    step: WorkflowStep,
  ): Promise<unknown> {
    const tracer = trace.getTracer('autotel-edge') as WorkerTracer;

    // Instrument the step object to track individual operations
    const instrumentedStep = instrumentWorkflowStep(step, workflowName);

    const spanName = `Workflow ${workflowName}: run`;

    return tracer.startActiveSpan(
      spanName,
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          'workflow.name': workflowName,
          'workflow.instance_id': event.instanceId,
          'faas.trigger': 'workflow',
          'faas.coldstart': isColdStart(workflowClass),
        },
      },
      async (span) => {
        try {
          const result = await runFn.call(this, event, instrumentedStep);
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  };
}

/**
 * Instrument a Workflow instance
 */
function instrumentWorkflowInstance(
  workflowInstance: Record<string, unknown>,
  workflowName: string,
  workflowClass: object,
): Record<string, unknown> {
  const instanceHandler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop) {
      const value = Reflect.get(target, prop);

      if (prop === 'run' && typeof value === 'function') {
        return instrumentWorkflowRun(
          value.bind(target) as WorkflowRunFn,
          workflowName,
          workflowClass,
        );
      }

      // Bind other methods to the target
      if (typeof value === 'function') {
        return value.bind(target);
      }

      return value;
    },
  };

  return wrap(workflowInstance, instanceHandler);
}

/**
 * Instrument a Cloudflare Workflow class
 *
 * This wraps the WorkflowEntrypoint class to automatically trace workflow execution,
 * step operations, retries, and sleeps.
 *
 * **Usage:**
 * ```typescript
 * import { WorkflowEntrypoint } from 'cloudflare:workers'
 * import { instrumentWorkflow } from 'autotel-cloudflare/handlers'
 *
 * class MyWorkflow extends WorkflowEntrypoint {
 *   async run(event, step) {
 *     await step.do('submit payment', async () => {
 *       return await submitToPaymentProcessor(event.payload.payment)
 *     })
 *
 *     await step.sleep('wait for feedback', '2 days')
 *
 *     await step.do('send feedback email', sendFeedbackEmail)
 *   }
 * }
 *
 * export const CheckoutWorkflow = instrumentWorkflow(
 *   MyWorkflow,
 *   'checkout-workflow',
 *   (env: Env) => ({
 *     exporter: {
 *       url: env.OTLP_ENDPOINT,
 *       headers: { 'x-api-key': env.API_KEY }
 *     },
 *     service: {
 *       name: 'checkout-workflow',
 *       version: '1.0.0'
 *     }
 *   })
 * )
 * ```
 *
 * @param workflowClass - The WorkflowEntrypoint class to instrument
 * @param workflowName - The name of the workflow (used in span names)
 * @param config - Configuration or configuration function
 * @returns Instrumented Workflow class
 */
export function instrumentWorkflow<
  C extends new (...args: any[]) => any,
>(
  workflowClass: C,
  workflowName: string,
  config: ConfigurationOption,
): C {
  const initialiser = createInitialiser(config);

  const classHandler: ProxyHandler<C> = {
    construct(target, args: any[]) {
      // Extract env from constructor args (typically last arg)
      const env = args[args.length - 1] || {};

      const trigger: WorkflowTrigger = { type: 'workflow', name: workflowName };
      const workflowConfig = initialiser(env, trigger);
      const context = setConfig(workflowConfig);

      // Create the workflow instance within the config context
      const workflowInstance = api_context.with(context, () => {
        return new target(...args);
      });

      // Instrument the instance
      return instrumentWorkflowInstance(
        workflowInstance,
        workflowName,
        workflowClass,
      );
    },
  };

  return wrap(workflowClass, classHandler);
}
