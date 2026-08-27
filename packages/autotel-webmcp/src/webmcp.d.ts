/**
 * `executeTool` is defined in the W3C draft (index.bs:607) and ships in
 * Chrome 151, but is missing from webmcp-types@0.1.5. Upstream PR pending.
 *
 * Chrome also requires the input as a JSON string rather than the object the
 * draft specifies — typed here as it actually behaves.
 */
declare namespace WebMCP {
  interface ModelContext {
    executeTool(
      tool: RegisteredTool,
      inputArguments: string,
      options?: { signal?: AbortSignal },
    ): Promise<string>;
  }
}
