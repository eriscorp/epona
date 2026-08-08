// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// The regression this file exists for: the Legacy Client tab used to be
// disabled off Windows behind a tooltip, and a persisted `targetKind: legacy`
// was redirected to the Hybrasyl tab. Both are gone — the tab is valid on every
// platform and shows the Dark Ages folder instead of a launch surface
// (HTOO-296). Nothing else in the suite would notice either coming back.

const savedSettings = { theme: 'hybrasyl', clientPath: '/home/user/DarkAges' }

// A stub that answers anything App reaches for. Named methods get real
// behaviour; everything else resolves undefined, and every `on*` returns an
// unsubscribe, which is what App stores in its effect cleanups.
function makeSparkAPI(platform) {
  const named = {
    platform,
    loadSettings: vi.fn().mockResolvedValue(savedSettings),
    saveSettings: vi.fn().mockResolvedValue({ ok: true }),
    getInstanceStatus: vi.fn().mockResolvedValue([]),
    inspectAssetDir: vi.fn().mockResolvedValue({ ok: true, datCount: 7 }),
    pickDirectory: vi.fn().mockResolvedValue(null),
    listVersions: vi.fn().mockResolvedValue([]),
    detectVersion: vi.fn().mockResolvedValue({ found: false }),
    getAppVersion: vi.fn().mockResolvedValue('2.7.2'),
    checkDotnetRuntime: vi.fn().mockResolvedValue({ ok: true })
  }
  return new Proxy(named, {
    get(target, prop) {
      if (prop in target) return target[prop]
      if (typeof prop === 'string' && prop.startsWith('on')) return () => () => {}
      return vi.fn().mockResolvedValue(undefined)
    }
  })
}

async function renderApp(platform) {
  global.window.sparkAPI = makeSparkAPI(platform)
  vi.resetModules()
  const { default: App } = await import('./App.jsx')
  const result = render(<App />)
  // Settings hydrate asynchronously; the tabs are painted before that resolves,
  // but the panel body depends on it.
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Legacy Client' })).toBeTruthy())
  return result
}

beforeEach(() => {
  savedSettings.targetKind = undefined
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe.each(['win32', 'darwin', 'linux'])('App on %s', (platform) => {
  it('shows all three tabs, none disabled', async () => {
    await renderApp(platform)
    for (const name of ['Legacy Client', 'Hybrasyl Client', 'Hybrasyl Server']) {
      const tab = screen.getByRole('tab', { name })
      expect(tab).toBeTruthy()
      // `aria-disabled` is what MUI sets on a disabled Tab. The old
      // LegacyTabDisabled wrapper is deleted and must not come back.
      expect(tab.getAttribute('aria-disabled')).not.toBe('true')
    }
  })

  it('opens the Legacy tab when that is the persisted target', async () => {
    savedSettings.targetKind = 'legacy'
    await renderApp(platform)
    // Previously this redirected to Hybrasyl Client off Windows.
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Legacy Client' }).getAttribute('aria-selected')).toBe(
        'true'
      )
    )
  })
})

describe('the Legacy panel body', () => {
  it('shows launch controls on Windows and no asset picker', async () => {
    await renderApp('win32')
    await userEvent.click(screen.getByRole('tab', { name: 'Legacy Client' }))
    await waitFor(() => expect(screen.queryByText(/Dark Ages folder/i)).toBeNull())
    expect(screen.queryByText(/Hybrasyl client reads its graphics/i)).toBeNull()
  })

  it.each(['darwin', 'linux'])('shows the asset folder and no launch controls on %s', async (p) => {
    await renderApp(p)
    await userEvent.click(screen.getByRole('tab', { name: 'Legacy Client' }))

    await waitFor(() =>
      expect(screen.getByText(/Hybrasyl client reads its graphics/i)).toBeTruthy()
    )
    expect(screen.getByText('/home/user/DarkAges')).toBeTruthy()
    // The Wine/CrossOver warning advertised a launch we cannot perform. It is
    // deleted, not hidden.
    expect(screen.queryByText(/CrossOver/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /^Launch/i })).toBeNull()
  })
})
