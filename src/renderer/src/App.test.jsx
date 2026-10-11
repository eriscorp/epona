// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { defaultSettings } from '../../shared/defaultSettings.js'

// The regression this file exists for: the Legacy Client tab used to be
// disabled off Windows behind a tooltip, and a persisted `targetKind: legacy`
// was redirected to the Hybrasyl tab. Both are gone — the tab is valid on every
// platform and shows the Dark Ages folder instead of a launch surface
// (HTOO-296). Nothing else in the suite would notice either coming back.

const savedSettings = { theme: 'hybrasyl', clientPath: '/home/user/DarkAges' }

// A stub that answers anything App reaches for. Named methods get real
// behaviour; everything else resolves undefined, and every `on*` returns an
// unsubscribe, which is what App stores in its effect cleanups.
function makeSparkAPI(platform, extra = {}) {
  const named = {
    ...extra,
    platform,
    // Named rather than left to the Proxy: the fallback mints a FRESH vi.fn per
    // property access, so an assertion on call count would always see zero.
    appReady: vi.fn(),
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

async function renderApp(platform, extra) {
  global.window.sparkAPI = makeSparkAPI(platform, extra)
  vi.resetModules()
  const { default: App } = await import('./App.jsx')
  const result = render(<App />)
  // Settings hydrate asynchronously; the tabs are painted before that resolves,
  // but the panel body depends on it.
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Legacy Client' })).toBeTruthy())
  return result
}

// Pay the cold transform of App.jsx and MUI once, before any test's clock runs.
// vi.resetModules() clears the registry, not the transform cache, so each test's
// re-import is then fast.
beforeAll(async () => {
  global.window.sparkAPI = makeSparkAPI('win32')
  await import('./App.jsx')
}, 60_000)

beforeEach(() => {
  savedSettings.targetKind = undefined
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// Each test re-imports App.jsx after vi.resetModules(). Before the warm-up above,
// the first one paid the cold MUI module load, which passed the 5 s default on a
// loaded machine; the import that the timeout abandoned then rendered into the
// next test ("multiple elements with the role tab"). The longer limit is margin.
describe.each(['win32', 'darwin', 'linux'])('App on %s', { timeout: 30_000 }, (platform) => {
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

describe('when the IPC bridge is unreachable', () => {
  // A guardIpc lockout rejects every channel, hydrate() among them. Before the
  // catch below existed, the rejection stopped the .then that signals app:ready:
  // main never heard it, so the splash sat for the full 15-second backstop and
  // the app then opened on defaults with every IPC-backed control dead — while
  // checkboxes and text fields still worked, because those never leave the
  // renderer. Nothing on screen said so, and Report Issue is itself an invoke.
  async function renderBroken() {
    global.window.sparkAPI = makeSparkAPI('win32')
    global.window.sparkAPI.loadSettings.mockRejectedValue(
      new Error('IPC "settings:load" rejected: untrusted sender (location-mismatch)')
    )
    vi.resetModules()
    const { default: App } = await import('./App.jsx')
    return render(<App />)
  }

  it('says so on screen instead of looking merely broken', async () => {
    await renderBroken()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/cannot reach its background process/i)
    // Name the two things the user would otherwise misread: dead buttons, and
    // settings that appear to revert.
    expect(alert.textContent).toMatch(/Buttons will not respond/i)
    expect(alert.textContent).toMatch(/showing\s+defaults/i)
    // The underlying error, so a report carries the actual cause.
    expect(alert.textContent).toMatch(/location-mismatch/)
  })

  it('still signals app:ready, so a broken bridge does not also cost 15 seconds', async () => {
    await renderBroken()
    await waitFor(() => expect(global.window.sparkAPI.appReady).toHaveBeenCalled())
  })

  it('shows no banner on a healthy boot', async () => {
    await renderApp('win32')
    expect(screen.queryByRole('alert')).toBeNull()
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

describe('the macOS application menu', () => {
  // App wires the menu to its own handlers (appMenu.test.jsx covers the hook).
  // These check the wiring: a Go command is the tab bar's change, and About
  // opens the Settings pane and then its About dialog.
  async function renderWithMenu() {
    let emit = () => {}
    const menu = {
      setMenuState: vi.fn(),
      onMenuCommand: vi.fn((cb) => {
        emit = cb
        return () => {}
      })
    }
    await renderApp('darwin', menu)
    await waitFor(() => expect(menu.onMenuCommand).toHaveBeenCalled())
    return { menu, send: (command) => act(() => emit({ command })) }
  }

  it('reports the tab once settings hydrate, and Go switches the tab', async () => {
    const { menu, send } = await renderWithMenu()
    expect(menu.setMenuState).toHaveBeenLastCalledWith({
      tab: 'legacy',
      canToggleLogPane: false,
      logPaneOpen: false
    })

    send('go:server')

    expect(screen.getByRole('tab', { name: 'Hybrasyl Server' }).getAttribute('aria-selected')).toBe(
      'true'
    )
    expect(menu.setMenuState).toHaveBeenLastCalledWith(expect.objectContaining({ tab: 'server' }))
  })

  it('keeps Log Pane enabled on another tab while the pane is open, so it can close it', async () => {
    savedSettings.targets = {
      ...defaultSettings.targets,
      hybrasyl: { ...defaultSettings.targets.hybrasyl, mode: 'repo' }
    }
    try {
      const { menu, send } = await renderWithMenu()
      send('go:hybrasyl')
      send('toggleLogPane')
      expect(menu.setMenuState).toHaveBeenLastCalledWith(
        expect.objectContaining({ canToggleLogPane: true, logPaneOpen: true })
      )

      // The pane stays open on the Legacy tab. A greyed-out, ticked item could
      // not close it.
      send('go:legacy')
      expect(menu.setMenuState).toHaveBeenLastCalledWith({
        tab: 'legacy',
        canToggleLogPane: true,
        logPaneOpen: true
      })
      send('toggleLogPane')
      expect(menu.setMenuState).toHaveBeenLastCalledWith({
        tab: 'legacy',
        canToggleLogPane: false,
        logPaneOpen: false
      })
    } finally {
      delete savedSettings.targets
    }
  })

  it('About opens the Settings pane and its About dialog', async () => {
    const { send } = await renderWithMenu()
    send('about')
    await waitFor(() => expect(screen.getByRole('dialog', { name: /About Epona/i })).toBeTruthy())
  })

  it('does not switch the tab under an open dialog', async () => {
    const { send } = await renderWithMenu()
    send('reportIssue')
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    send('go:server')
    expect(
      // hidden: the open dialog sets aria-hidden on the rest of the app.
      screen.getByRole('tab', { name: 'Legacy Client', hidden: true }).getAttribute('aria-selected')
    ).toBe('true')
  })

  it('is inert on Windows', async () => {
    const menu = { setMenuState: vi.fn(), onMenuCommand: vi.fn(() => () => {}) }
    await renderApp('win32', menu)
    expect(menu.onMenuCommand).not.toHaveBeenCalled()
    expect(menu.setMenuState).not.toHaveBeenCalled()
  })
})
