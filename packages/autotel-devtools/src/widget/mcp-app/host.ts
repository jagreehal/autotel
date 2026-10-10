/**
 * The view side of MCP Apps (SEP-1865): JSON-RPC over `postMessage` with the
 * host page that framed this view (Claude, ChatGPT, VS Code...).
 *
 * Only the messages a read-only view needs: the `ui/initialize` handshake,
 * the tool result, theme changes, a size report, and model context updates.
 */

export const PROTOCOL_VERSION = '2026-01-26';

export type HostTheme = 'light' | 'dark';

export interface HostContext {
  theme?: HostTheme;
  [key: string]: unknown;
}

/** The CallToolResult the host forwards from the tool call. */
export interface ToolResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface HostHandlers {
  onToolResult: (result: ToolResult) => void;
  onHostContext?: (context: HostContext) => void;
}

export interface HostConnection {
  hostContext: HostContext;
  /** Replaces what the model sees from this view on the next user turn. */
  updateModelContext: (context: {
    text: string;
    structuredContent?: Record<string, unknown>;
  }) => Promise<void>;
  /** Report content height so the host sizes the frame to fit. */
  reportSize: (height: number) => void;
  close: () => void;
}

interface RpcMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

function isRpcMessage(data: unknown): data is RpcMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { jsonrpc?: unknown }).jsonrpc === '2.0'
  );
}

export async function connectToHost(
  handlers: HostHandlers,
  target: Window = window.parent,
  self: Window = window,
): Promise<HostConnection> {
  let nextId = 1;
  const pending = new Map<
    number | string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const send = (message: Omit<RpcMessage, 'jsonrpc'>) =>
    target.postMessage({ jsonrpc: '2.0', ...message }, '*');
  const request = (method: string, params: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      send({ id, method, params });
    });

  const onMessage = (event: MessageEvent) => {
    if (event.source !== target || !isRpcMessage(event.data)) return;
    const message = event.data;
    if (message.method === undefined) {
      const waiter =
        message.id === undefined ? undefined : pending.get(message.id);
      if (!waiter || message.id === undefined) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
      return;
    }
    switch (message.method) {
      case 'ui/notifications/tool-result':
        handlers.onToolResult(message.params as ToolResult);
        break;
      case 'ui/notifications/host-context-changed':
        handlers.onHostContext?.(message.params as HostContext);
        break;
      case 'ui/resource-teardown':
        if (message.id !== undefined) send({ id: message.id, result: {} });
        break;
      default:
        // A request this view does not serve still gets an answer, so the
        // host is not left waiting on it.
        if (message.id !== undefined) {
          send({
            id: message.id,
            error: { code: -32601, message: `${message.method} not handled` },
          });
        }
    }
  };
  self.addEventListener('message', onMessage);

  const result = (await request('ui/initialize', {
    appInfo: { name: 'autotel-trace-view', version: '1' },
    appCapabilities: {},
    protocolVersion: PROTOCOL_VERSION,
  })) as { hostContext?: HostContext } | undefined;
  send({ method: 'ui/notifications/initialized', params: {} });

  return {
    hostContext: result?.hostContext ?? {},
    updateModelContext: async ({ text, structuredContent }) => {
      await request('ui/update-model-context', {
        content: [{ type: 'text', text }],
        ...(structuredContent ? { structuredContent } : {}),
      });
    },
    reportSize: (height) =>
      send({ method: 'ui/notifications/size-changed', params: { height } }),
    close: () => self.removeEventListener('message', onMessage),
  };
}
