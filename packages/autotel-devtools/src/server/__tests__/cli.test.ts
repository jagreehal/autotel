import { describe, it, expect, afterEach } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { resolve as pathResolve } from 'node:path'

const CLI_PATH = pathResolve(__dirname, '../../../dist/cli.js')
const PKG_DIR = pathResolve(__dirname, '../../../')

describe('CLI', () => {
  let proc: ChildProcess | null = null

  afterEach(() => {
    if (proc && !proc.killed) {
      proc.kill('SIGTERM')
    }
    proc = null
  })

  it('prints help with --help', async () => {
    const output = await runCli(['--help'])
    expect(output).toContain('autotel-devtools')
    expect(output).toContain('--port')
    expect(output).toContain('[port]') // positional shorthand is documented
    expect(output).toContain('/v1/traces')
    expect(output).toContain('widget.js')
  })

  it('prints version with --version', async () => {
    const output = await runCli(['--version'])
    // Output may contain npm warnings on stderr; extract the last non-empty line
    const lines = output.trim().split('\n').map(l => l.trim()).filter(Boolean)
    const versionLine = lines[lines.length - 1]
    expect(versionLine).toMatch(/^\d+\.\d+\.\d+$|^unknown$/)
  })

  it('starts server on specified port', async () => {
    const port = 9123 + Math.floor(Math.random() * 100)
    proc = spawn(process.execPath, [CLI_PATH, '-p', String(port)], {
      cwd: PKG_DIR,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const output = await waitForOutput(proc, 'OTLP', 5000)
    expect(output).toContain(String(port))

    // Verify server is actually listening
    const res = await fetch(`http://127.0.0.1:${port}/healthz`)
    expect(res.status).toBe(200)
  })

  it('accepts port as the first positional argument', async () => {
    const port = 9223 + Math.floor(Math.random() * 100)
    proc = spawn(process.execPath, [CLI_PATH, String(port)], {
      cwd: PKG_DIR,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const output = await waitForOutput(proc, 'OTLP', 5000)
    expect(output).toContain(String(port))

    const res = await fetch(`http://127.0.0.1:${port}/healthz`)
    expect(res.status).toBe(200)
  })

  it('combines positional port with --host', async () => {
    const port = 9323 + Math.floor(Math.random() * 100)
    proc = spawn(process.execPath, [CLI_PATH, String(port), '-H', '127.0.0.1'], {
      cwd: PKG_DIR,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const output = await waitForOutput(proc, 'OTLP', 5000)
    expect(output).toContain(String(port))

    const res = await fetch(`http://127.0.0.1:${port}/healthz`)
    expect(res.status).toBe(200)
  })

  it('rejects invalid port with non-zero exit', async () => {
    const child = spawn(process.execPath, [CLI_PATH, 'not-a-port'], {
      cwd: PKG_DIR,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const exitCode: number = await new Promise((resolve) => {
      child.on('close', (code) => resolve(code ?? -1))
      setTimeout(() => { child.kill(); resolve(-1) }, 3000)
    })
    expect(exitCode).not.toBe(0)
  })

  it('falls forward to the next free port when the requested one is taken', async () => {
    const port = 9523 + Math.floor(Math.random() * 100)
    // Occupy the requested port before launching the CLI.
    const blocker = spawn(process.execPath, ['-e', `require('http').createServer().listen(${port}, '127.0.0.1')`], {
      stdio: 'ignore',
    })
    await new Promise<void>((r) => setTimeout(r, 250))

    try {
      proc = spawn(process.execPath, [CLI_PATH, String(port)], {
        cwd: PKG_DIR,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      // Wait for the port-fallback warning — it's printed AFTER the URL
      // block, so we get the full startup output in one go.
      const output = await waitForOutput(proc, 'was busy', 5000)
      expect(output).toMatch(new RegExp(`port ${port} was busy`))
      // The reported UI URL should be on a different port (port+1, since we
      // only block one port).
      expect(output).toMatch(/http:\/\/127\.0\.0\.1:\d+/)
      const actual = Number(output.match(/http:\/\/127\.0\.0\.1:(\d+)/)![1])
      expect(actual).toBeGreaterThan(port)

      // Confirm the new port is actually listening.
      const res = await fetch(`http://127.0.0.1:${actual}/healthz`)
      expect(res.status).toBe(200)
    } finally {
      blocker.kill('SIGTERM')
    }
  })

  function runCli(args: string[]): Promise<string> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI_PATH, ...args], {
        cwd: PKG_DIR,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let output = ''
      child.stdout?.on('data', (d) => output += d.toString())
      child.stderr?.on('data', (d) => output += d.toString())
      child.on('close', () => resolve(output))
      setTimeout(() => { child.kill(); resolve(output) }, 3000)
    })
  }

  function waitForOutput(child: ChildProcess, substring: string, timeout: number): Promise<string> {
    return new Promise((resolve, reject) => {
      let output = ''
      const timer = setTimeout(() => reject(new Error(`Timeout waiting for "${substring}"`)), timeout)
      child.stdout?.on('data', (data) => {
        output += data.toString()
        if (output.includes(substring)) {
          clearTimeout(timer)
          resolve(output)
        }
      })
      child.stderr?.on('data', (data) => {
        output += data.toString()
        if (output.includes(substring)) {
          clearTimeout(timer)
          resolve(output)
        }
      })
    })
  }
})
