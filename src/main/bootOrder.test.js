import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

// Boot-order invariants that no behavioural test can catch, because breaking
// them throws nothing and warns nothing — the app just quietly stops doing the
// thing it says it does.
//
// These read the source rather than run it. src/main/index.js cannot be
// imported in a unit test: it calls app.setPath and takes the single-instance
// lock at module scope. A static assertion is the cheapest guard that survives
// a boot reordering, and a reordering is exactly what would defeat the fix.

const indexPath = join(dirname(fileURLToPath(import.meta.url)), 'index.js')

// Strip full-line comments only. Every comment in index.js is a full line, and
// this leaves URLs (`https://…`) intact, which a naive `//` strip would cut in
// half. Both invariants below are stated in prose in a comment ABOVE the code
// that implements them, so comparing raw offsets compares a comment against a
// call and gets the wrong answer.
function sourceWithoutComments() {
  return readFileSync(indexPath, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n')
}

describe('main-process boot order', () => {
  it('disables hardware acceleration before app.whenReady', () => {
    // app.disableHardwareAcceleration() after 'ready' does not throw and does
    // not warn in a way anyone reads. It simply has no effect, so a reordering
    // leaves the module, its tests, the comment above the call and the tracker
    // card all describing a fix that stopped happening, with every gate green.
    const src = sourceWithoutComments()
    const disable = src.indexOf('disableHardwareAcceleration()')
    const ready = src.indexOf('whenReady')
    expect(disable).toBeGreaterThan(-1)
    expect(ready).toBeGreaterThan(-1)
    expect(disable).toBeLessThan(ready)
  })

  it('sets the userData path before app.whenReady', () => {
    // Same failure shape, and the comment at the call says so: once Chromium
    // has resolved and locked the default userData dir, overriding it later is
    // ignored. Guarded here because the two calls sit together and a
    // reordering would take both.
    const src = sourceWithoutComments()
    const setPath = src.indexOf("setPath('userData'")
    const ready = src.indexOf('whenReady')
    expect(setPath).toBeGreaterThan(-1)
    expect(setPath).toBeLessThan(ready)
  })

  it('would fail without stripping comments — the guard the naive test misses', () => {
    // Not a test of the app: a test of the test. index.js explains the
    // whenReady constraint in prose ABOVE the call, so in the raw source the
    // word appears first and the naive assertion fails on correct code. A test
    // that fails on a correct file gets deleted rather than fixed, so this
    // pins the reason the stripping is there.
    const raw = readFileSync(indexPath, 'utf-8')
    expect(raw.indexOf('whenReady')).toBeLessThan(raw.indexOf('disableHardwareAcceleration()'))
  })
})
