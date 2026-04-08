import { describe, it, expect, afterEach } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { resolve as pathResolve } from 'node:path'

const CLI_PATH = pathResolve(__dirname, '../../cli.ts')
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
    proc = spawn('npx', ['tsx', CLI_PATH, '-p', String(port)], {
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

  function runCli(args: string[]): Promise<string> {
    return new Promise((resolve) => {
      const child = spawn('npx', ['tsx', CLI_PATH, ...args], {
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
