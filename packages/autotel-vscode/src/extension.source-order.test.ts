import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('extension source ordering', () => {
  it('declares provider classes and instantiates them in activate()', () => {
    const source = readFileSync(join(__dirname, 'extension.ts'), 'utf8')

    for (const className of ['ServicesProvider', 'TracesProvider', 'LogsProvider', 'ErrorsProvider']) {
      expect(source.indexOf(`class ${className}`), `expected class ${className} to be declared`).toBeGreaterThan(-1)
      expect(
        source.indexOf(`new ${className}()`),
        `expected ${className} to be instantiated`,
      ).toBeGreaterThan(-1)
    }

    const activateIndex = source.indexOf('export function activate(')
    expect(activateIndex).toBeGreaterThan(-1)

    for (const className of ['ServicesProvider', 'TracesProvider', 'LogsProvider', 'ErrorsProvider']) {
      const newIndex = source.indexOf(`new ${className}()`)
      expect(
        newIndex,
        `expected ${className} to be instantiated inside activate()`,
      ).toBeGreaterThan(activateIndex)
    }
  })
})
