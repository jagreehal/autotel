import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Regression guard for the 5.0.1 bug: `import * as protobuf from 'protobufjs'` left
 * `protobuf.Root` undefined in the bundled ESM output, so every protobuf request was
 * rejected with `protobuf.Root is not a constructor` — but only when loaded by Node
 * (what `npx autotel-devtools` runs). vitest's vite loader resolves CJS interop
 * differently, so the source-level tests passed while the shipped artifact was broken.
 *
 * This test runs the check in a real Node process against the built `dist/` bundle.
 * CI builds before testing; locally we build on demand if `dist/` is missing.
 */
const pkgRoot = resolve(__dirname, '../../..')
const distEntry = resolve(pkgRoot, 'dist/server/index.js')
const smokeScript = resolve(pkgRoot, 'scripts/check-dist-esm.mjs')

describe('built ESM bundle: protobuf decoders load under Node', () => {
  beforeAll(() => {
    if (!existsSync(distEntry)) {
      execFileSync('pnpm', ['build'], { cwd: pkgRoot, stdio: 'inherit' })
    }
  }, 180_000)

  it('decodes OTLP/protobuf from dist/ in a real Node process (no `protobuf.Root` error)', () => {
    // Throws (non-zero exit) if the bundle can't load or decode — the exact 5.0.1 failure.
    const output = execFileSync('node', [smokeScript], { cwd: pkgRoot, encoding: 'utf8' })
    expect(output).toContain('dist ESM smoke OK')
  })
})
