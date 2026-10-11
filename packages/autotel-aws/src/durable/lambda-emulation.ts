/**
 * Test support: fills in what Lambda sends and the local runner does not.
 */

import type { DurableLambdaHandler } from '@aws/durable-execution-sdk-js';

const COMPLETED_OUTSIDE_INVOCATIONS = new Set([
  'WAIT',
  'CALLBACK',
  'CHAINED_INVOKE',
]);
const DONE = new Set([
  'SUCCEEDED',
  'FAILED',
  'TIMED_OUT',
  'CANCELLED',
  'STOPPED',
]);

/**
 * Lambda lists in `UpdatedOperationIds` the operations that changed between
 * invocations; the local runner sends none. Waits, callbacks and chained
 * invokes only ever complete between invocations, so the first invocation
 * that sees one done is the one Lambda would list it for.
 */
export function withUpdatedOperationIds(
  handler: DurableLambdaHandler,
): DurableLambdaHandler {
  const listed = new Set<string>();
  return (event, lambdaContext) => {
    const UpdatedOperationIds: string[] = [];
    for (const { Id, Type, Status } of event.InitialExecutionState.Operations) {
      if (
        Id &&
        Type &&
        Status &&
        COMPLETED_OUTSIDE_INVOCATIONS.has(Type) &&
        DONE.has(Status) &&
        !listed.has(Id)
      ) {
        UpdatedOperationIds.push(Id);
      }
    }
    for (const id of UpdatedOperationIds) listed.add(id);
    // Set in place: the runner's event carries its checkpoint client, which a
    // spread copy would drop.
    event.UpdatedOperationIds = UpdatedOperationIds;
    return handler(event, lambdaContext);
  };
}
