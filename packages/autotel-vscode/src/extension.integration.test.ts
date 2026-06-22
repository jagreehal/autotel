import { createServer } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  return {
    port: 0,
    treeProviders: new Map<string, { getChildren(element?: unknown): unknown[] }>(),
  }
})

vi.mock('vscode', () => {
  return {
    commands: {
      registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
    },
    window: {
      createOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), dispose: vi.fn() })),
      createStatusBarItem: vi.fn(() => ({
        text: '',
        tooltip: '',
        command: '',
        show: vi.fn(),
        dispose: vi.fn(),
      })),
      showWarningMessage: vi.fn(async () => undefined),
      showInformationMessage: vi.fn(async () => undefined),
      showInputBox: vi.fn(async () => undefined),
      registerTreeDataProvider: vi.fn((id: string, provider: { getChildren(element?: unknown): unknown[] }) => {
        state.treeProviders.set(id, provider)
        return { dispose: vi.fn() }
      }),
      createWebviewPanel: vi.fn(),
      showTextDocument: vi.fn(async () => undefined),
      StatusBarAlignment: { Left: 1 },
    },
    EventEmitter: class<T> {
      event = (_listener: (value: T | undefined) => void) => ({ dispose: () => {} })
      fire(_value: T | undefined) {}
      dispose() {}
    },
    TreeItem: class {
      constructor(public label: string, public collapsibleState?: number) {}
      description?: string
      iconPath?: unknown
      tooltip?: string
      contextValue?: string
      command?: unknown
    },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeIcon: class {
      constructor(public id: string) {}
    },
    ViewColumn: { Beside: -2 },
    workspace: {
      getConfiguration: vi.fn(() => ({
        get: vi.fn((key: string, fallback: unknown) => {
          if (key === 'receiver.autoStart') return 'always'
          if (key === 'receiver.host') return '127.0.0.1'
          if (key === 'receiver.port') return state.port
          if (key === 'buffer.maxSpans') return 10000
          if (key === 'buffer.maxLogs') return 10000
          return fallback
        }),
        update: vi.fn(async () => undefined),
      })),
      onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      createFileSystemWatcher: vi.fn(() => ({
        onDidChange: vi.fn(),
        onDidCreate: vi.fn(),
        onDidDelete: vi.fn(),
        dispose: vi.fn(),
      })),
      workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
      openTextDocument: vi.fn(async (uri: unknown) => ({ uri })),
    },
    env: {
      clipboard: {
        writeText: vi.fn(async () => undefined),
      },
    },
    Uri: {
      file: (fsPath: string) => ({ fsPath }),
      joinPath: (...parts: Array<{ fsPath?: string } | string>) => ({
        fsPath: parts.map((p) => (typeof p === 'string' ? p : p.fsPath ?? '')).join('/'),
      }),
    },
    Range: class {
      constructor(
        public startLineNumber: number,
        public startColumn: number,
        public endLineNumber: number,
        public endColumn: number,
      ) {}
    },
    ConfigurationTarget: { Workspace: 2 },
    StatusBarAlignment: { Left: 1 },
    languages: {
      registerCodeLensProvider: vi.fn(() => ({ dispose: () => {} })),
      registerHoverProvider: vi.fn(() => ({ dispose: () => {} })),
    },
    ProgressLocation: { Notification: 15 },
    MarkdownString: class {
      value = ''
      isTrusted = false
      appendMarkdown(text: string) {
        this.value += text
        return this
      }
    },
    Hover: class { constructor(public contents: unknown) {} },
    CodeLens: class { constructor(public range: unknown, public command?: unknown) {} },
  }
})

import { activate, deactivate } from './extension'

async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to get free port')))
        return
      }
      const port = address.port
      server.close((error) => {
        if (error) reject(error)
        else resolve(port)
      })
    })
  })
}

describe('extension OTLP integration', () => {
  beforeEach(async () => {
    state.treeProviders.clear()
    state.port = await getFreePort()
    deactivate()
  })

  afterEach(() => {
    deactivate()
  })

  it('ingests OTLP traces over HTTP and updates trace tree provider', async () => {
    const context = {
      subscriptions: [] as { dispose(): void }[],
      extensionUri: { fsPath: '/tmp/autotel-vscode' },
    }
    activate(context as never)
    await new Promise((resolve) => setTimeout(resolve, 30))

    const payload = {
      resourceSpans: [
        {
          resource: {
            attributes: [{ key: 'service.name', value: { stringValue: 'svc-api' } }],
          },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                  spanId: 'bbbbbbbbbbbbbbbb',
                  parentSpanId: '',
                  name: 'GET /health',
                  kind: 2,
                  startTimeUnixNano: '1000000000',
                  endTimeUnixNano: '3000000000',
                  attributes: [{ key: 'http.method', value: { stringValue: 'GET' } }],
                  status: { code: 1 },
                },
              ],
            },
          ],
        },
      ],
    }

    const response = await fetch(`http://127.0.0.1:${state.port}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    expect(response.status).toBe(200)

    const tracesProvider = state.treeProviders.get('autotel.traces')
    expect(tracesProvider).toBeDefined()
    const roots = tracesProvider?.getChildren() ?? []
    expect(roots.length).toBe(1)
  })
})
