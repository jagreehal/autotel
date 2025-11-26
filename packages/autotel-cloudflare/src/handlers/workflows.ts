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
import type { ConfigurationOption } from 'autotel-edge';
import { createInitialiser, setConfig, WorkerTracer } from 'autotel-edge';
import { wrap } from '../bindings/common';

// Workflow types (these would come from @cloudflare/workers-types when available)
type WorkflowEvent = any;
type WorkflowStep = any;

type WorkflowRunFn = (
  event: WorkflowEvent,
  step: WorkflowStep,
) => Promise<void> | void;

/**
 * Track cold starts per Workflow class
 */
const coldStarts = new WeakMap<any, boolean>();

function isColdStart(workflowClass: any): boolean {
  if (!coldStarts.has(workflowClass)) {
    coldStarts.set(workflowClass, true);
    return true;
  }
  return false;
}

/**
 * Proxy the step object to instrument step.do() calls
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
            const [stepName] = args as [string, () => Promise<any>];

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
  workflowClass: any,
): WorkflowRunFn {
  return async function instrumentedRun(
    this: any,
    event: WorkflowEvent,
    step: WorkflowStep,
  ): Promise<void> {
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
          'faas.trigger': 'workflow',
          'faas.coldstart': isColdStart(workflowClass),
          // Add workflow event attributes if available
          ...(event?.workflowId && { 'workflow.id': event.workflowId }),
          ...(event?.runId && { 'workflow.run_id': event.runId }),
        },
      },
      async (span) => {
        try {
          await runFn.call(this, event, instrumentedStep);
          span.setStatus({ code: SpanStatusCode.OK });
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
  workflowInstance: any,
  workflowName: string,
  workflowClass: any,
): any {
  const instanceHandler: ProxyHandler<any> = {
    get(target, prop) {
      const value = Reflect.get(target, prop);

      if (prop === 'run' && typeof value === 'function') {
        return instrumentWorkflowRun(
          value.bind(target),
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
 * import { instrumentWorkflow } from 'autotel-edge'
 *
 * export class CheckoutWorkflow extends WorkflowEntrypoint {
 *   async run(event, step) {
 *     await step.do('submit payment', async () => {
 *       return await submitToPaymentProcessor(event.params.payment)
 *     })
 *
 *     await step.sleep('wait for feedback', '2 days')
 *
 *     await step.do('send feedback email', sendFeedbackEmail)
 *   }
 * }
 *
 * // Wrap the class before exporting
 * export const CheckoutWorkflowInstrumented = instrumentWorkflow(
 *   CheckoutWorkflow,
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
 * **What you get:**
 * - 🎯 Automatic spans for workflow.run() execution
 * - 📋 Automatic spans for each step.do() operation
 * - ⏸️ Automatic spans for step.sleep() operations
 * - 🔄 Automatic retry tracking (via step.do retries)
 * - 🥶 Cold start tracking
 * - ⚡ Automatic span lifecycle management
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

      // Initialize config for this workflow instance
      // Use Request as trigger type since workflows don't have a standard Trigger type yet
      const trigger = new Request('https://workflow.local/run');
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

