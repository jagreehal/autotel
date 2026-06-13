import { describe, it, expect } from 'vitest'
import {
  isLoopbackHostname,
  hostHeaderIsLoopback,
  originIsLoopback,
  allowSensitiveRequest,
} from '../origin-guard'

describe('isLoopbackHostname', () => {
  it('accepts loopback hostnames', () => {
    for (const h of ['localhost', 'LOCALHOST', '127.0.0.1', '127.1.2.3', '::1', '[::1]']) {
      expect(isLoopbackHostname(h)).toBe(true)
    }
  })
  it('rejects non-loopback hostnames', () => {
    for (const h of ['evil.com', '0.0.0.0', '10.0.0.5', '192.168.1.4', '169.254.1.1']) {
      expect(isLoopbackHostname(h)).toBe(false)
    }
  })
})

describe('hostHeaderIsLoopback', () => {
  it('strips the port and brackets', () => {
    expect(hostHeaderIsLoopback('localhost:4318')).toBe(true)
    expect(hostHeaderIsLoopback('127.0.0.1:9999')).toBe(true)
    expect(hostHeaderIsLoopback('[::1]:4318')).toBe(true)
    expect(hostHeaderIsLoopback('evil.com:4318')).toBe(false)
    expect(hostHeaderIsLoopback('myhost.local')).toBe(false)
  })
})

describe('originIsLoopback', () => {
  it('accepts loopback origins on any port and scheme', () => {
    expect(originIsLoopback('http://localhost:3000')).toBe(true)
    expect(originIsLoopback('http://127.0.0.1:4318')).toBe(true)
    expect(originIsLoopback('https://localhost')).toBe(true)
    expect(originIsLoopback('http://[::1]:5173')).toBe(true)
  })
  it('rejects remote and opaque origins', () => {
    expect(originIsLoopback('https://evil.com')).toBe(false)
    expect(originIsLoopback('http://attacker.io:4318')).toBe(false)
    expect(originIsLoopback('null')).toBe(false) // sandboxed iframe
    expect(originIsLoopback('not a url')).toBe(false)
  })
})

describe('allowSensitiveRequest', () => {
  it('allows no-origin requests with a loopback host (curl / node / same-origin)', () => {
    expect(allowSensitiveRequest({ host: '127.0.0.1:4318' }, true)).toBe(true)
    expect(allowSensitiveRequest({ host: 'localhost:4318' }, true)).toBe(true)
    expect(allowSensitiveRequest({}, true)).toBe(true)
  })

  it('allows an embedded widget / dev app on a loopback origin', () => {
    expect(
      allowSensitiveRequest({ origin: 'http://localhost:3000', host: '127.0.0.1:4318' }, true),
    ).toBe(true)
  })

  it('rejects a cross-origin read regardless of bind mode', () => {
    expect(
      allowSensitiveRequest({ origin: 'https://evil.com', host: '127.0.0.1:4318' }, true),
    ).toBe(false)
    expect(
      allowSensitiveRequest({ origin: 'https://evil.com', host: '127.0.0.1:4318' }, false),
    ).toBe(false)
  })

  it('rejects a non-loopback Host (DNS rebinding) when bound to loopback', () => {
    expect(allowSensitiveRequest({ host: 'attacker.com' }, true)).toBe(false)
  })

  it('skips the Host check when bound to a non-loopback host (opt-in exposure)', () => {
    // `--host 0.0.0.0`: a legitimate LAN client sends a non-loopback Host and no
    // Origin — it must still be allowed; only the Origin check remains.
    expect(allowSensitiveRequest({ host: '192.168.1.50:4318' }, false)).toBe(true)
  })
})
