// src/server/__tests__/listen.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { listenLoopbackDualStack } from '../listen'

function occupy(port: number): { server: Server; port: number } {
  const s = createServer()
  // Bind synchronously. Caller is expected to pass a real port, not 0 —
  // the function resolves the OS-assigned port so the test can name it
  // back to the listen helper.
  s.listen(port, '127.0.0.1')
  const addr = s.address()
  const bound = addr && typeof addr === 'object' ? addr.port : port
  if (bound === 0) {
    throw new Error('occupy() needs a real port, not 0 (port 0 picks a free port)')
  }
  return { server: s, port: bound }
}

const occupied: { server: Server; port: number }[] = []

afterEach(() => {
  while (occupied.length) {
    const { server } = occupied.pop()!
    server.close()
  }
})

describe('listenLoopbackDualStack', () => {
  it('binds the requested port when free', async () => {
    const primary = createServer()
    const { ready } = listenLoopbackDualStack({
      primary,
      port: 0, // ask the kernel for a free port
      host: '127.0.0.1',
      attachSecondary: () => {},
    })
    const { port, addresses } = await ready
    expect(port).toBeGreaterThan(0)
    expect(addresses[0]).toBe(`127.0.0.1:${port}`)
    primary.close()
  })

  it('falls forward to the next free port when the requested one is taken', async () => {
    // Use a random high port to minimise collisions with parallel tests.
    const blockerPort = 20000 + Math.floor(Math.random() * 10000)
    const blocker = occupy(blockerPort)
    occupied.push(blocker)

    const primary = createServer()
    const { ready } = listenLoopbackDualStack({
      primary,
      port: blocker.port,
      host: '127.0.0.1',
      attachSecondary: () => {},
    })
    const { port, warnings } = await ready

    // Should have skipped the blocker and grabbed port+1 (or further).
    expect(port).toBeGreaterThan(blocker.port)
    expect(warnings.some((w) => w.includes(`${blocker.port} was busy`))).toBe(true)
    primary.close()
  })

  it('rejects after exhausting maxTries consecutive busy ports', async () => {
    // Block 5 consecutive ports. Use a random start to avoid parallel runs
    // colliding with this very test.
    const start = 30000 + Math.floor(Math.random() * 10000)
    const blockers: { server: Server; port: number }[] = []
    for (let i = 0; i < 5; i++) {
      blockers.push(occupy(start + i))
    }
    occupied.push(...blockers)

    const primary = createServer()
    const { ready } = listenLoopbackDualStack({
      primary,
      port: start,
      host: '127.0.0.1',
      attachSecondary: () => {},
      maxTries: 4,
    })
    await expect(ready).rejects.toThrow(/could not bind/)
    primary.close()
  })
})
