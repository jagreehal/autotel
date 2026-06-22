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
  createFileSystemWatcher,
  findFiles,
  readFile,
  detection,
} =
  vi.hoisted(() => {
    const fakeServer = {
      once: vi.fn(),
      // DevtoolsServer attaches a WebSocketServer + request listener to the
      // server, so it must expose `.on` / `.removeListener` / `.address` even in
      // the unit mock (close() tears the WS listeners back down).
      on: vi.fn(),
      removeListener: vi.fn(),
      address: vi.fn(() => ({ port: 4318 })),
      listen: vi.fn(),
      close: vi.fn((cb?: () => void) => cb?.()),
    }
    return {
      receiverConfig: {
        autoStart: 'always',
        host: '127.0.0.1',
        port: 4318,
        maxSpans: 10000,
        maxLogs: 10000,
      },
      // Controls what workspaceUsesAutotel() detects in the package.json scan.
      // `files` is the list findFiles returns; when `autotelPath` is set only
      // that file carries the dependency, otherwise `hasAutotelDep` applies to
      // every file.
      detection: {
        hasAutotelDep: true,
        files: ['/workspace/package.json'] as string[],
        autotelPath: null as string | null,
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
      findFiles: vi.fn(async () => detection.files.map((fsPath) => ({ fsPath }))),
      readFile: vi.fn(async (uri: { fsPath: string }) => {
        const has = detection.autotelPath
          ? uri.fsPath === detection.autotelPath
          : detection.hasAutotelDep
        return new TextEncoder().encode(
          JSON.stringify(
            has
              ? { dependencies: { autotel: '^1.0.0' } }
              : { dependencies: { express: '^4.0.0' } },
          ),
        )
      }),
      getConfiguration: vi.fn(() => ({
        get: vi.fn((key: string, fallback: unknown) => {
          if (key === 'receiver.autoStart') return receiverConfig.autoStart
          if (key === 'receiver.host') return receiverConfig.host
          if (key === 'receiver.port') return receiverConfig.port
          if (key === 'buffer.maxSpans') return receiverConfig.maxSpans
          if (key === 'buffer.maxLogs') return receiverConfig.maxLogs
          return fallback
        }),
        update: vi.fn(),
      })),
      onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      createFileSystemWatcher: vi.fn(() => ({
        onDidChange: vi.fn(),
        onDidCreate: vi.fn(),
        onDidDelete: vi.fn(),
        dispose: vi.fn(),
      })),
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
      createFileSystemWatcher,
      workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
      openTextDocument,
      findFiles,
      fs: { readFile },
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
    Hover: class {
      constructor(public contents: unknown) {}
    },
    CodeLens: class {
      constructor(public range: unknown, public command?: unknown) {}
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
    findFiles.mockClear()
    readFile.mockClear()
    detection.hasAutotelDep = true
    detection.files = ['/workspace/package.json']
    detection.autotelPath = null
    receiverConfig.autoStart = 'always'
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

    expect(registerCommand).toHaveBeenCalledTimes(13)
    expect(registered).toEqual(
      expect.arrayContaining([
        'autotel.start',
        'autotel.stop',
        'autotel.setPort',
        'autotel.clear',
        'autotel.revealSource',
        'autotel.copySpanId',
        'autotel.openSpanDetail',
        'autotel.openDevtools',
      ]),
    )
  })

  it('adds command disposables to extension subscriptions', () => {
    const context = { subscriptions: [] as { dispose(): void }[] }

    activate(context as never)

    expect(context.subscriptions.length).toBeGreaterThanOrEqual(7)
  })

  it('starts receiver on activate when autoStart is "always"', async () => {
    receiverConfig.autoStart = 'always'
    const context = { subscriptions: [] as { dispose(): void }[] }

    activate(context as never)
    await new Promise((resolve) => setImmediate(resolve))

    expect(createServer).toHaveBeenCalledTimes(1)
    expect(fakeServer.listen).toHaveBeenCalledTimes(1)
  })

  it('does not start receiver on activate when autoStart is "off"', async () => {
    receiverConfig.autoStart = 'off'
    const context = { subscriptions: [] as { dispose(): void }[] }

    activate(context as never)
    await new Promise((resolve) => setImmediate(resolve))

    expect(createServer).not.toHaveBeenCalled()
    expect(fakeServer.listen).not.toHaveBeenCalled()
  })

  it('auto-starts on "onAutotelProject" when the workspace depends on autotel', async () => {
    receiverConfig.autoStart = 'onAutotelProject'
    detection.hasAutotelDep = true
    const context = { subscriptions: [] as { dispose(): void }[] }

    activate(context as never)
    await new Promise((resolve) => setImmediate(resolve))

    expect(createServer).toHaveBeenCalledTimes(1)
    expect(fakeServer.listen).toHaveBeenCalledTimes(1)
  })

  it('detects autotel in a large monorepo regardless of scan position', async () => {
    // Regression guard: detection must not be capped to the first N package.json
    // files, or auto-start becomes nondeterministic in big monorepos.
    receiverConfig.autoStart = 'onAutotelProject'
    const files = Array.from({ length: 250 }, (_, i) => `/workspace/packages/p${i}/package.json`)
    detection.files = files
    detection.autotelPath = files[200] // well past any small cap
    const context = { subscriptions: [] as { dispose(): void }[] }

    activate(context as never)
    await new Promise((resolve) => setImmediate(resolve))

    expect(createServer).toHaveBeenCalledTimes(1)
    expect(fakeServer.listen).toHaveBeenCalledTimes(1)
  })

  it('stays stopped on "onAutotelProject" when no autotel dependency is present', async () => {
    receiverConfig.autoStart = 'onAutotelProject'
    detection.hasAutotelDep = false
    const context = { subscriptions: [] as { dispose(): void }[] }

    activate(context as never)
    await new Promise((resolve) => setImmediate(resolve))

    expect(createServer).not.toHaveBeenCalled()
    expect(fakeServer.listen).not.toHaveBeenCalled()
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

  // Payload-size limiting and OTLP route handling now live in the shared
  // DevtoolsServer / attachDevtoolsRoutes (tested in the autotel-devtools
  // package), so the extension no longer owns a bespoke request handler to
  // unit-test here. The HTTP ingest path is covered end-to-end in
  // extension.integration.test.ts against a real server.

  it('auto-start on a non-loopback host blocks silently without a modal prompt', async () => {
    // Auto-start must never nag: opening a window where host is set to 0.0.0.0
    // should not pop a modal on every activation — it blocks and logs instead.
    receiverConfig.host = '0.0.0.0'
    const context = { subscriptions: [] as { dispose(): void }[] }

    activate(context as never)
    await new Promise((resolve) => setImmediate(resolve))

    expect(showWarningMessage).not.toHaveBeenCalled()
    expect(createServer).not.toHaveBeenCalled()
  })

  it('manual start prompts on a non-loopback host and does not start without consent', async () => {
    receiverConfig.autoStart = 'off'
    receiverConfig.host = '0.0.0.0'
    showWarningMessage.mockResolvedValue(undefined)
    const context = { subscriptions: [] as { dispose(): void }[] }
    activate(context as never)

    await commandHandlers.get('autotel.start')?.()
    await new Promise((resolve) => setImmediate(resolve))

    expect(showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('0.0.0.0'),
      { modal: true },
      'Start anyway',
    )
    expect(createServer).not.toHaveBeenCalled()
  })

  it('manual start binds a non-loopback host once consent is granted', async () => {
    receiverConfig.autoStart = 'off'
    receiverConfig.host = '0.0.0.0'
    showWarningMessage.mockResolvedValue('Start anyway')
    const context = { subscriptions: [] as { dispose(): void }[] }
    activate(context as never)

    await commandHandlers.get('autotel.start')?.()
    await new Promise((resolve) => setImmediate(resolve))

    expect(createServer).toHaveBeenCalledTimes(1)
    expect(fakeServer.listen).toHaveBeenCalledTimes(1)
  })

  it('auto-start stays silent when the port is already in use', async () => {
    // Simulate EADDRINUSE: the error handler fires instead of listen succeeding.
    fakeServer.listen.mockImplementation(() => fakeServer)
    fakeServer.once.mockImplementation((event: string, cb: (err: NodeJS.ErrnoException) => void) => {
      if (event === 'error') cb(Object.assign(new Error('in use'), { code: 'EADDRINUSE' }))
      return fakeServer
    })
    const context = { subscriptions: [] as { dispose(): void }[] }

    activate(context as never)
    await new Promise((resolve) => setImmediate(resolve))

    expect(showWarningMessage).not.toHaveBeenCalled()
  })
})
