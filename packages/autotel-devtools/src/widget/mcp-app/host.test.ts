import { describe, expect, it, vi } from 'vitest';
import { connectToHost, PROTOCOL_VERSION } from './host';

/** A host frame: records what the view posts, and answers ui/initialize. */
function fakeHost(self: Window) {
  const sent: Array<Record<string, unknown>> = [];
  const host = {
    postMessage: (message: Record<string, unknown>) => {
      sent.push(message);
      if (message.method === 'ui/initialize') {
        deliver({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            hostInfo: { name: 'test-host', version: '1' },
            hostCapabilities: {},
            hostContext: { theme: 'dark' },
          },
        });
      }
      if (message.method === 'ui/update-model-context') {
        deliver({ jsonrpc: '2.0', id: message.id, result: {} });
      }
    },
  } as unknown as Window;
  function deliver(data: unknown) {
    self.dispatchEvent(new MessageEvent('message', { data, source: host }));
  }
  return { host, sent, deliver };
}

describe('connectToHost', () => {
  it('initializes, then reports itself initialized', async () => {
    const { host, sent } = fakeHost(window);
    const connection = await connectToHost({ onToolResult: () => {} }, host);

    expect(sent[0]).toMatchObject({
      method: 'ui/initialize',
      params: { protocolVersion: PROTOCOL_VERSION },
    });
    expect(sent[1]).toMatchObject({ method: 'ui/notifications/initialized' });
    expect(connection.hostContext.theme).toBe('dark');
    connection.close();
  });

  it('hands the tool result and context changes to the view', async () => {
    const { host, deliver } = fakeHost(window);
    const onToolResult = vi.fn();
    const onHostContext = vi.fn();
    const connection = await connectToHost(
      { onToolResult, onHostContext },
      host,
    );

    deliver({
      jsonrpc: '2.0',
      method: 'ui/notifications/tool-result',
      params: { content: [{ type: 'text', text: '{}' }] },
    });
    deliver({
      jsonrpc: '2.0',
      method: 'ui/notifications/host-context-changed',
      params: { theme: 'light' },
    });

    expect(onToolResult).toHaveBeenCalledWith({
      content: [{ type: 'text', text: '{}' }],
    });
    expect(onHostContext).toHaveBeenCalledWith({ theme: 'light' });
    connection.close();
  });

  it('ignores messages from any window but the host', async () => {
    const { host } = fakeHost(window);
    const onToolResult = vi.fn();
    const connection = await connectToHost({ onToolResult }, host);

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          jsonrpc: '2.0',
          method: 'ui/notifications/tool-result',
          params: {},
        },
        source: window,
      }),
    );

    expect(onToolResult).not.toHaveBeenCalled();
    connection.close();
  });

  it('sends model context and size, and answers teardown', async () => {
    const { host, sent, deliver } = fakeHost(window);
    const connection = await connectToHost({ onToolResult: () => {} }, host);

    await connection.updateModelContext({
      text: 'picked span a',
      structuredContent: { selectedSpan: { spanId: 'a' } },
    });
    connection.reportSize(240);
    deliver({ jsonrpc: '2.0', id: 'td', method: 'ui/resource-teardown' });

    expect(sent).toContainEqual(
      expect.objectContaining({
        method: 'ui/update-model-context',
        params: {
          content: [{ type: 'text', text: 'picked span a' }],
          structuredContent: { selectedSpan: { spanId: 'a' } },
        },
      }),
    );
    expect(sent).toContainEqual(
      expect.objectContaining({
        method: 'ui/notifications/size-changed',
        params: { height: 240 },
      }),
    );
    expect(sent).toContainEqual(
      expect.objectContaining({ id: 'td', result: {} }),
    );
    connection.close();
  });
});
