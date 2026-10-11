import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, dirname } from 'path'
import { fileURLToPath } from 'url'
import { GO_TABS } from '../../shared/appMenu.js'

// Structural guards for the macOS support. Both faults they catch produce a
// working app and a green gate on Windows, and show only on a Mac:
//
// 1. A tab added to App.jsx and not to the Go menu (or the reverse). The menu is
//    a second list of the same tabs, so it is compared with App.jsx rather than
//    trusted to be kept in step.
// 2. A new `ctrlKey || metaKey`. On macOS that steals ⌃K and ⌃P from every text
//    field, and a Control-click there is a right-click. Epona's renderer binds no
//    command key today; a binding added later must treat ⌘ alone as the command
//    key on macOS (the house `isModKey`), not either key.

const RENDERER = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(p, 'utf8')

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return sourceFiles(p)
    return /\.(js|jsx)$/.test(name) && !/\.test\.(js|jsx)$/.test(name) ? [p] : []
  })
}

describe('the Go menu and the tab bar list the same tabs', () => {
  const app = read(join(RENDERER, 'App.jsx'))
  const order = JSON.parse(app.match(/const TAB_ORDER = (\[[^\]]*\])/)[1].replace(/'/g, '"'))
  const labels = [...app.matchAll(/<Tab value=\{\d\} label="([^"]+)"/g)].map((m) => m[1])

  it('finds the tabs (guard the guard)', () => {
    expect(order.length).toBe(3)
    expect(labels.length).toBe(3)
  })

  it('has every tab, in order, with the label the tab bar shows', () => {
    expect(GO_TABS.map((t) => t.tab)).toEqual(order)
    expect(GO_TABS.map((t) => t.label)).toEqual(labels)
  })
})

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
