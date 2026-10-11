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

  it('takes the single-instance lock after setPath and the GPU call, before whenReady', () => {
    // HTOO-351. The lock is keyed on the userData directory, so a lock taken
    // before the setPath override keys on Electron's default path, and two
    // builds that disagree about where their data lives never see each other.
    // After whenReady there is nothing left to prevent. The GPU call stays above
    // the lock because it is a no-op after ready, and a losing instance exits
    // before it renders, so its rendering mode never matters.
    const src = sourceWithoutComments()
    const setPath = src.indexOf("setPath('userData'")
    const gpu = src.indexOf('disableHardwareAcceleration()')
    const lock = src.indexOf('requestSingleInstanceLock()')
    const ready = src.indexOf('whenReady')
    expect(lock).toBeGreaterThan(-1)
    expect(setPath).toBeLessThan(gpu)
    expect(gpu).toBeLessThan(lock)
    expect(lock).toBeLessThan(ready)
  })

  it('takes the lock before any module-scope side effect', () => {
    // Statement forms, not names. A bare name also matches an import or a
    // function declaration, which can sit above the lock by construction.
    const src = sourceWithoutComments()
    const lock = src.indexOf('requestSingleInstanceLock()')
    for (const statement of [
      /^installGlobalErrorHandlers\(/m,
      /^void initSessionLog\(/m,
      /^\s+migrateSettingsFromRoaming\(dataDir\)/m,
      /^\s+settingsManager = createSettingsManager\(/m
    ]) {
      const at = src.search(statement)
      expect(at, `${statement} not found in index.js`).toBeGreaterThan(-1)
      expect(at, `${statement} runs before the lock`).toBeGreaterThan(lock)
    }
  })

  it('restores, shows and focuses on a second launch, in that order', () => {
    // Without restore() first, a minimised window takes focus in the taskbar and
    // does not come forward, which reads as the second launch doing nothing.
    // Before the reveal, the handler does nothing: the window is still hidden
    // and unhydrated, and the reveal brings it forward.
    const src = sourceWithoutComments()
    const start = src.indexOf("app.on('second-instance'")
    expect(start).toBeGreaterThan(-1)
    const handler = src.slice(start, src.indexOf('\n  })', start))
    expect(handler).toMatch(/if \(mainWindowRevealed\) focusMainWindow\(\)/)
    const helperStart = src.indexOf('function focusMainWindow()')
    expect(helperStart).toBeGreaterThan(-1)
    const helper = src.slice(helperStart, src.indexOf('\n  }', helperStart))
    const restore = helper.indexOf('mainWindow.restore()')
    const show = helper.indexOf('mainWindow.show()')
    const focus = helper.indexOf('mainWindow.focus()')
    expect(restore).toBeGreaterThan(-1)
    expect(restore).toBeLessThan(show)
    expect(show).toBeLessThan(focus)
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

describe('the CSP call site (HTOO-467)', () => {
  // windowSecurity.test.js proves the header string and the installer. Neither
  // can see whether index.js still CALLS the installer, or calls it before a
  // window loads. A policy installed after a document starts to load is a policy
  // that document never had, and the failure is silent: the app runs, the meta
  // tag still applies, and only the splash loses its policy.

  it('installs the policy on the default session', () => {
    expect(sourceWithoutComments()).toMatch(
      /installContentSecurityPolicy\(\s*session\.defaultSession/
    )
  })

  it('installs it before either window loads', () => {
    const src = sourceWithoutComments()
    const install = src.indexOf('installContentSecurityPolicy(')
    const splash = src.indexOf('createSplashWindow()')
    // The boot CALL of the main window. `createWindow()` is wrong here: its first
    // call is inside the body of `function createAndWireMainWindow()`, which is a
    // definition, not the boot. The lookbehind skips that declaration.
    const main = src.search(/(?<!function )createAndWireMainWindow\(\)/)
    expect(install, 'the CSP installer is gone from index.js').toBeGreaterThan(-1)
    expect(splash, 'createSplashWindow() is gone from index.js').toBeGreaterThan(-1)
    expect(main, 'createAndWireMainWindow() is gone from index.js').toBeGreaterThan(-1)
    expect(install, 'the splash loads before the CSP is installed').toBeLessThan(splash)
    expect(install, 'the main window loads before the CSP is installed').toBeLessThan(main)
  })

  it('chooses the dev policy from the loaded URL, never from NODE_ENV', () => {
    // The two policies differ, and the dev one relaxes script-src. The built main
    // bundle reads NODE_ENV at run time, so a key on it lets a user's shell
    // relax a packaged app. The e2e helper also sets NODE_ENV=test.
    const src = sourceWithoutComments()
    expect(src).toMatch(/rendererDevUrl\(\) \? DEV_RENDERER_CSP : RENDERER_CSP/)
    expect(src).not.toMatch(/NODE_ENV/)
  })
})
