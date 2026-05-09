import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  registerCommand,
  createOutputChannel,
  createStatusBarItem,
  showWarningMessage,
  showInformationMessage,
  showInputBox,
  getConfiguration,
  onDidChangeConfiguration,
  createServer,
  fakeServer,
  parseOtlpTraces,
  parseOtlpLogs,
  appendManyWithLimit,
  resolveTelemetryLimits,
  createdDisposables,
  commandHandlers,
  openTextDocument,
  showTextDocument,
  writeClipboardText,
  registerTreeDataProvider,
  createWebviewPanel,
  receiverConfig,
} =
  vi.hoisted(() => {
    const fakeServer = {
      once: vi.fn(),
      listen: vi.fn(),
      close: vi.fn((cb?: () => void) => cb?.()),
    }
    return {
      receiverConfig: {
        enabled: true,
        host: '127.0.0.1',
        port: 4318,
        maxSpans: 10000,
        maxLogs: 10000,
      },
      registerCommand: vi.fn(),
      createOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), dispose: vi.fn() })),
      createStatusBarItem: vi.fn(() => ({
        text: '',
        tooltip: '',
        command: '',
        show: vi.fn(),
        dispose: vi.fn(),
      })),
      showWarningMessage: vi.fn(),
      showInformationMessage: vi.fn(),
      openTextDocument: vi.fn(async (uri: { fsPath: string }) => ({ uri })),
      showTextDocument: vi.fn(async () => undefined),
      showInputBox: vi.fn(),
      getConfiguration: vi.fn(() => ({
        get: vi.fn((key: string, fallback: unknown) => {
          if (key === 'receiver.enabled') return receiverConfig.enabled
          if (key === 'receiver.host') return receiverConfig.host
          if (key === 'receiver.port') return receiverConfig.port
          if (key === 'buffer.maxSpans') return receiverConfig.maxSpans
          if (key === 'buffer.maxLogs') return receiverConfig.maxLogs
          return fallback
        }),
        update: vi.fn(),
      })),
      onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      writeClipboardText: vi.fn(async () => undefined),
      createServer: vi.fn(() => fakeServer),
      fakeServer,
      parseOtlpTraces: vi.fn(() => []),
      parseOtlpLogs: vi.fn(() => []),
      appendManyWithLimit: vi.fn((items: unknown[], incoming: unknown[]) => [...items, ...incoming]),
      resolveTelemetryLimits: vi.fn(() => ({ maxTraceCount: 10000, maxLogCount: 10000, maxMetricCount: 10000 })),
      createdDisposables: [] as Array<{ dispose: ReturnType<typeof vi.fn> }>,
      commandHandlers: new Map<string, (arg?: unknown) => void>(),
      registerTreeDataProvider: vi.fn(() => ({ dispose: vi.fn() })),
      createWebviewPanel: vi.fn(),
    }
  })

vi.mock('node:http', () => {
  return {
    createServer,
  }
})

vi.mock('autotel-devtools/server', () => {
  class ErrorAggregator {
    addErrorsFromTrace() { return [] }
    getErrorGroupsByFrequency() { return [] }
    clear() {}
  }
  return {
    parseOtlpTraces,
    parseOtlpLogs,
    appendManyWithLimit,
    resolveTelemetryLimits,
    ErrorAggregator,
  }
})

vi.mock('vscode', () => {
  return {
    commands: {
      registerCommand,
    },
    window: {
      createOutputChannel,
      createStatusBarItem,
      showWarningMessage,
      showInformationMessage,
      showTextDocument,
      showInputBox,
      registerTreeDataProvider,
      createWebviewPanel,
      StatusBarAlignment: { Left: 1 },
    },
    EventEmitter: class<T> {
      private listeners: Array<(value: T | undefined) => void> = []
      event = (listener: (value: T | undefined) => void) => {
        this.listeners.push(listener)
        return { dispose: () => {} }
      }
      fire(value: T | undefined) {
        for (const listener of this.listeners) listener(value)
      }
      dispose() {
        this.listeners = []
      }
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
    ThemeIcon: class { constructor(public id: string) {} },
    ViewColumn: { Beside: -2 },
    workspace: {
      getConfiguration,
      onDidChangeConfiguration,
      workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
      openTextDocument,
    },
    env: {
      clipboard: {
        writeText: writeClipboardText,
      },
    },
    Uri: {
      file: (fsPath: string) => ({ fsPath }),
    },
    Range: class {
      constructor(
        public startLineNumber: number,
        public startColumn: number,
        public endLineNumber: number,
        public endColumn: number,
      ) {}
    },
    ConfigurationTarget: {
      Workspace: 2,
    },
    StatusBarAlignment: {
      Left: 1,
    },
  }
})

import { activate, deactivate } from './extension'

describe('activate', () => {
  beforeEach(() => {
    deactivate()
    registerCommand.mockReset()
    createOutputChannel.mockClear()
    createStatusBarItem.mockClear()
    showWarningMessage.mockClear()
    showWarningMessage.mockResolvedValue(undefined)
    showInformationMessage.mockReset()
    showInputBox.mockReset()
    openTextDocument.mockReset()
    showTextDocument.mockReset()
    writeClipboardText.mockReset()
    getConfiguration.mockClear()
    onDidChangeConfiguration.mockClear()
    createServer.mockClear()
    fakeServer.once.mockReset()
    fakeServer.listen.mockReset()
    fakeServer.close.mockReset()
    fakeServer.close.mockImplementation((cb?: () => void) => cb?.())
    parseOtlpTraces.mockClear()
    parseOtlpLogs.mockClear()
    appendManyWithLimit.mockClear()
    resolveTelemetryLimits.mockClear()
    createdDisposables.length = 0
    commandHandlers.clear()
    receiverConfig.enabled = true
    receiverConfig.host = '127.0.0.1'
    receiverConfig.port = 4318
    receiverConfig.maxSpans = 10000
    receiverConfig.maxLogs = 10000
    registerCommand.mockImplementation(() => {
      const [name, handler] = registerCommand.mock.lastCall as [string, (arg?: unknown) => void]
      commandHandlers.set(name, handler)
      const disposable = { dispose: vi.fn() }
      createdDisposables.push(disposable)
      return disposable
    })
    fakeServer.listen.mockImplementation((_port: number, _host: string, cb?: () => void) => cb?.())
    fakeServer.once.mockImplementation(() => fakeServer)
  })

  it('registers required v0.1 commands', () => {
    const context = { subscriptions: [] as { dispose(): void }[] }

    activate(context as never)

    const registered = registerCommand.mock.calls.map((call) => call[0])

    expect(registerCommand).toHaveBeenCalledTimes(7)
    expect(registered).toEqual(
      expect.arrayContaining([
        'autotel.start',
        'autotel.stop',
        'autotel.setPort',
        'autotel.clear',
        'autotel.revealSource',
        'autotel.copySpanId',
        'autotel.openSpanDetail',
      ]),
    )
  })

  it('adds command disposables to extension subscriptions', () => {
    const context = { subscriptions: [] as { dispose(): void }[] }

    activate(context as never)

    expect(context.subscriptions.length).toBeGreaterThanOrEqual(7)
  })

  it('starts receiver on activate when enabled', async () => {
    const context = { subscriptions: [] as { dispose(): void }[] }

    activate(context as never)
    await new Promise((resolve) => setImmediate(resolve))

    expect(createServer).toHaveBeenCalledTimes(1)
    expect(fakeServer.listen).toHaveBeenCalledTimes(1)
  })

  it('deactivate disposes registered command disposables', () => {
    const context = { subscriptions: [] as { dispose(): void }[] }

    activate(context as never)
    deactivate()

    for (const disposable of createdDisposables) {
      expect(disposable.dispose).toHaveBeenCalledTimes(1)
    }
  })

  it('copies span id from command arg', async () => {
    const context = { subscriptions: [] as { dispose(): void }[] }
    activate(context as never)

    const command = commandHandlers.get('autotel.copySpanId')
    expect(command).toBeDefined()
    await command?.({ spanId: 'abc123' })

    expect(writeClipboardText).toHaveBeenCalledWith('abc123')
  })

  it('reveals source for in-workspace path from command arg', async () => {
    const context = { subscriptions: [] as { dispose(): void }[] }
    activate(context as never)

    const command = commandHandlers.get('autotel.revealSource')
    expect(command).toBeDefined()
    await command?.({ filepath: '/workspace/src/app.ts', lineno: 7 })

    expect(openTextDocument).toHaveBeenCalledWith({ fsPath: '/workspace/src/app.ts' })
    expect(showTextDocument).toHaveBeenCalledTimes(1)
  })

  it('rejects reveal source for sibling path outside workspace boundary', async () => {
    const context = { subscriptions: [] as { dispose(): void }[] }
    activate(context as never)

    const command = commandHandlers.get('autotel.revealSource')
    expect(command).toBeDefined()
    await command?.({ filepath: '/workspace2/src/app.ts', lineno: 7 })

    expect(openTextDocument).not.toHaveBeenCalled()
    expect(showWarningMessage).toHaveBeenCalledWith(
      'Refusing to open source outside the workspace.',
    )
  })

  it('returns 413 for oversized OTLP payloads', async () => {
    const context = { subscriptions: [] as { dispose(): void }[] }
    activate(context as never)
    await new Promise((resolve) => setImmediate(resolve))

    const firstCall = createServer.mock.calls[0] as unknown as unknown[] | undefined
    const serverHandler = firstCall?.[0] as
      | ((req: unknown, res: unknown) => void | Promise<void>)
      | undefined
    expect(serverHandler).toBeDefined()

    const hugeChunk = Buffer.alloc(10 * 1024 * 1024 + 1, 1)
    const req = {
      method: 'POST',
      url: '/v1/traces',
      async *[Symbol.asyncIterator]() {
        yield hugeChunk
      },
    }
    const writeHead = vi.fn()
    const end = vi.fn()
    const res = { writeHead, end }

    await serverHandler?.(req, res)
    await new Promise((resolve) => setImmediate(resolve))

    expect(writeHead).toHaveBeenCalledWith(
      413,
      expect.objectContaining({ 'content-type': 'application/json' }),
    )
  })

  it('does not start receiver on non-loopback host without consent', async () => {
    receiverConfig.host = '0.0.0.0'
    showWarningMessage.mockResolvedValue(undefined)
    const context = { subscriptions: [] as { dispose(): void }[] }

    activate(context as never)
    await new Promise((resolve) => setImmediate(resolve))

    expect(showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('0.0.0.0'),
      { modal: true },
      'Start anyway',
    )
    expect(createServer).not.toHaveBeenCalled()
  })

  it('starts receiver on non-loopback host when consent is granted', async () => {
    receiverConfig.host = '0.0.0.0'
    showWarningMessage.mockResolvedValue('Start anyway')
    const context = { subscriptions: [] as { dispose(): void }[] }

    activate(context as never)
    await new Promise((resolve) => setImmediate(resolve))

    expect(createServer).toHaveBeenCalledTimes(1)
    expect(fakeServer.listen).toHaveBeenCalledTimes(1)
  })
})
