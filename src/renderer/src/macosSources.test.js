import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, dirname } from 'path'
import { fileURLToPath } from 'url'

// A structural guard for the macOS support. The fault it catches produces a
// working app and a green gate on Windows, and shows only on a Mac: a new
// `ctrlKey || metaKey`. On macOS that steals ⌃K and ⌃P from every text field,
// and a Control-click there is a right-click. Epona's renderer binds no command
// key today; a binding added later must treat ⌘ alone as the command key on
// macOS (the house `isModKey`), not either key.

const RENDERER = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(p, 'utf8')

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return sourceFiles(p)
    return /\.(js|jsx)$/.test(name) && !/\.test\.(js|jsx)$/.test(name) ? [p] : []
  })
}

describe('no hand-rolled command-key test in the renderer', () => {
  const files = sourceFiles(RENDERER)
  const pattern = /ctrlKey\s*\|\|\s*\w+\.metaKey|metaKey\s*\|\|\s*\w+\.ctrlKey/

  it('walks the renderer source (guard the guard)', () => {
    expect(files.length).toBeGreaterThan(30)
    expect(files.some((f) => f.endsWith('App.jsx'))).toBe(true)
  })

  it('has no `ctrlKey || metaKey`', () => {
    const offenders = files.filter((f) => pattern.test(read(f))).map((f) => relative(RENDERER, f))
    expect(offenders, 'on macOS the command key is ⌘ alone: use an isModKey helper').toEqual([])
  })
})
