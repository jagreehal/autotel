/**
 * The name to record for a failed MCP operation.
 *
 * A tool handler can reject with anything, so asking the value what it is beats
 * asserting it into an Error it may never have been.
 */
export function errorName(cause: unknown): string {
  return cause instanceof Error && cause.name ? cause.name : 'Error';
}
