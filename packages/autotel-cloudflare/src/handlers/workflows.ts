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
  context as api_context,
  SpanStatusCode,
  SpanKind,
} from '@opentelemetry/api';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import type { ConfigurationOption, WorkflowTrigger } from 'autotel-edge';
import {
  createInitialiser,
  setConfig,
  WorkerTracer,
  withoutNativeTracer,
  type NativeTracer,
} from 'autotel-edge';
import { platformNativeTracer } from '../native/native-tracing';
import { wrap } from '../bindings/common';
import { toException } from '../exception.js';
import { workerTracer } from '../tracer.js';
import { initProvider } from '../provider.js';
import { asFunction, boundMethod, member, trapArgs } from '../values.js';

type WorkflowRunFn = (
  event: Readonly<WorkflowEvent<unknown>>,
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
 * Instrument a Workflow step: a span around each do(), sleep() and
 * sleepUntil(). In workerd `step` is an RPC stub, so every call goes through
 * boundMethod rather than the stub's own apply or bind.
 */
function instrumentWorkflowStep(
  step: WorkflowStep,
  workflowName: string,
): WorkflowStep {
  const traced =
    (
      call: (...args: unknown[]) => unknown,
      describe: (args: unknown[]) => {
        name: string;
        attributes: Record<string, string>;
      },
    ) =>
    (...args: unknown[]) => {
      const { name, attributes } = describe(args);
      return workerTracer('autotel-edge').startActiveSpan(
        `Workflow ${workflowName}: ${name}`,
        {
          kind: SpanKind.INTERNAL,
          attributes: { ...attributes, 'workflow.name': workflowName },
        },
        async (span) => {
          try {
            const result = await call(...args);
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
          } catch (error) {
            span.recordException(toException(error));
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

  return wrap(step, {
    get(target, prop) {
      const value = member(target, prop);
      const method = asFunction(value);
      if (!method) return value;
      const call = boundMethod(method, target);

      if (prop === 'do') {
        return traced(call, (args) => {
          const [stepName] = trapArgs<[string, ...unknown[]]>(args);
          return {
            name: stepName,
            attributes: { 'workflow.step.name': stepName },
          };
        });
      }
      if (prop === 'sleep') {
        return traced(call, (args) => {
          const [sleepName, duration] =
            trapArgs<[string, string | number]>(args);
          return {
            name: `sleep ${sleepName}`,
            attributes: {
              'workflow.sleep.name': sleepName,
              'workflow.sleep.duration': String(duration),
            },
          };
        });
      }
      if (prop === 'sleepUntil') {
        return traced(call, (args) => {
          const [sleepName, timestamp] =
            trapArgs<[string, Date | number]>(args);
          return {
            name: `sleepUntil ${sleepName}`,
            attributes: {
              'workflow.sleep.name': sleepName,
              'workflow.sleep.until': new Date(timestamp).toISOString(),
            },
          };
        });
      }
      return call;
    },
  });
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
    event: Readonly<WorkflowEvent<unknown>>,
    step: WorkflowStep,
  ): Promise<unknown> {
    const tracer = workerTracer('autotel-edge');

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
      withoutNativeTracer(),
      async (span) => {
        try {
          const result = await runFn.call(this, event, instrumentedStep);
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error) {
          span.recordException(toException(error));
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });
          throw error;
        } finally {
          span.end();
          // Nothing waits on the span processor's own flush once run()
          // returns, so export the trace before handing back the result.
          if (tracer instanceof WorkerTracer) {
            await tracer
              .forceFlush(span.spanContext().traceId)
              .catch((error: unknown) =>
                console.error(
                  '[autotel-cloudflare] Failed to export spans:',
                  error,
                ),
              );
          }
        }
      },
    );
  };
}

/**
 * Native tracing: Cloudflare traces the run and step RPC calls but not step
 * names, so wrap only `step.do()` in a named native span.
 */
function nativeWorkflowInstance(
  workflowInstance: Record<string, unknown>,
  workflowName: string,
  tracer: NativeTracer,
): Record<string, unknown> {
  return wrap(workflowInstance, {
    get(target, prop) {
      const value = member(target, prop);
      const method = asFunction(value);
      if (prop !== 'run' || !method) {
        return method ? method.bind(target) : value;
      }
      return (event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) =>
        method.call(
          target,
          event,
          wrap(step, {
            get(stepTarget, stepProp) {
              const stepValue = member(stepTarget, stepProp);
              const stepMethod = asFunction(stepValue);
              // `step` is an RPC stub: `.bind`/`.apply` on its members would
              // be sent as RPC calls, so pass through and use Reflect.apply.
              if (stepProp !== 'do' || !stepMethod) {
                return stepValue;
              }
              return (...args: unknown[]) => {
                const [stepName] = trapArgs<[string, ...unknown[]]>(args);
                return tracer.enterSpan(
                  `Workflow ${workflowName}: ${stepName}`,
                  (span) => {
                    // setAttribute: the one span method every runtime has.
                    span.setAttribute('workflow.name', workflowName);
                    span.setAttribute('workflow.step.name', stepName);
                    span.setAttribute('workflow.instance_id', event.instanceId);
                    return Reflect.apply(stepMethod, stepTarget, args);
                  },
                );
              };
            },
          }),
        );
    },
  });
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
      const value = member(target, prop);
      const method = asFunction(value);

      if (prop === 'run' && method) {
        return instrumentWorkflowRun(
          method.bind(target) as WorkflowRunFn,
          workflowName,
          workflowClass,
        );
      }

      // Bind other methods to the target
      return method ? method.bind(target) : value;
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
export function instrumentWorkflow<C extends new (...args: any[]) => any>(
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

      if (platformNativeTracer && workflowConfig.nativeTracing !== 'off') {
        return nativeWorkflowInstance(
          workflowInstance,
          workflowName,
          platformNativeTracer,
        );
      }

      // OTLP mode: a Workflow can run in an isolate where no Worker handler
      // has registered the provider yet.
      initProvider(workflowConfig);
      return instrumentWorkflowInstance(
        workflowInstance,
        workflowName,
        workflowClass,
      );
    },
  };

  return wrap(workflowClass, classHandler);
}
