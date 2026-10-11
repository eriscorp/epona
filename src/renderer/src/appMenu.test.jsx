// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useMenuStore } from './store/menuStore'
import { runMenuCommand, isModalOpen, useAppMenu } from './appMenu.js'
import { useMenuRequest } from './useMenuRequest'

// The renderer half of the macOS menu. src/main/appMenu.test.js covers the menu
// itself; this covers what a command does when it reaches the renderer.

function bridge(platform) {
  const listeners = new Set()
  window.sparkAPI = {
    platform,
    setMenuState: vi.fn(),
    onMenuCommand: vi.fn((cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    })
  }
  return { emit: (msg) => listeners.forEach((cb) => cb(msg)), listeners }
}

const actions = () => ({
  goTab: vi.fn(),
  openSettings: vi.fn(),
  locateClient: vi.fn(),
  revealSettings: vi.fn(),
  revealLogs: vi.fn(),
  toggleLogPane: vi.fn(),
  openHelp: vi.fn(),
  openReportIssue: vi.fn()
})

const STATE = { tab: 'legacy', canToggleLogPane: false, logPaneOpen: false }

beforeEach(() => {
  useMenuStore.setState({ pending: {} })
  bridge('win32')
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  delete window.sparkAPI
})

describe('runMenuCommand', () => {
  it('sends a Go command to the tab handler', () => {
    const a = actions()
    runMenuCommand({ command: 'go:server' }, a)
    expect(a.goTab).toHaveBeenCalledWith('server')
  })

  it('does nothing while a modal is open', () => {
    const modal = document.createElement('div')
    modal.className = 'MuiModal-root'
    document.body.appendChild(modal)
    expect(isModalOpen()).toBe(true)
    const a = actions()
    for (const command of ['go:server', 'settings', 'about', 'reportIssue', 'locateClient']) {
      runMenuCommand({ command }, a)
    }
    for (const fn of Object.values(a)) expect(fn).not.toHaveBeenCalled()
    expect(useMenuStore.getState().pending).toEqual({})
  })

  it('treats a hidden, kept-mounted modal as closed', () => {
    const modal = document.createElement('div')
    modal.className = 'MuiModal-root MuiModal-hidden'
    document.body.appendChild(modal)
    expect(isModalOpen()).toBe(false)
  })

  it.each(['about', 'whatsNew'])('%s leaves a request and opens Settings', (command) => {
    const a = actions()
    runMenuCommand({ command }, a)
    expect(a.openSettings).toHaveBeenCalled()
    expect(useMenuStore.getState().pending[command]).toBeDefined()
  })

  it.each([
    ['settings', 'openSettings'],
    ['locateClient', 'locateClient'],
    ['revealSettings', 'revealSettings'],
    ['revealLogs', 'revealLogs'],
    ['toggleLogPane', 'toggleLogPane'],
    ['recommendedInstalls', 'openHelp'],
    ['reportIssue', 'openReportIssue']
  ])('%s runs %s', (command, action) => {
    const a = actions()
    runMenuCommand({ command }, a)
    expect(a[action]).toHaveBeenCalledTimes(1)
  })

  it('ignores a message with no command', () => {
    expect(() => runMenuCommand(undefined, actions())).not.toThrow()
    expect(() => runMenuCommand({ command: 7 }, actions())).not.toThrow()
  })
})

describe('useMenuRequest', () => {
  it('runs a request made before the component mounted, once', () => {
    act(() => useMenuStore.getState().request('about'))
    const handler = vi.fn()
    const { rerender } = renderHook(() => useMenuRequest('about', handler))
    expect(handler).toHaveBeenCalledTimes(1)
    rerender()
    expect(handler).toHaveBeenCalledTimes(1)
    expect(useMenuStore.getState().pending.about).toBeUndefined()
  })

  it('runs a repeat request again, and leaves other commands alone', () => {
    const about = vi.fn()
    const whatsNew = vi.fn()
    renderHook(() => {
      useMenuRequest('about', about)
      useMenuRequest('whatsNew', whatsNew)
    })
    act(() => useMenuStore.getState().request('about'))
    act(() => useMenuStore.getState().request('about'))
    expect(about).toHaveBeenCalledTimes(2)
    expect(whatsNew).not.toHaveBeenCalled()
  })

  it('runs nothing after clear()', () => {
    act(() => {
      useMenuStore.getState().request('about')
      useMenuStore.getState().clear()
    })
    const handler = vi.fn()
    renderHook(() => useMenuRequest('about', handler))
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('useAppMenu', () => {
  it('on macOS: reports the state, re-reports on a change, and runs commands', () => {
    const { emit } = bridge('darwin')
    const a = actions()
    const { rerender } = renderHook(({ state }) => useAppMenu(true, state, a), {
      initialProps: { state: STATE }
    })
    const { setMenuState } = window.sparkAPI
    expect(setMenuState).toHaveBeenLastCalledWith(STATE)

    // The same state again sends nothing.
    rerender({ state: { ...STATE } })
    expect(setMenuState).toHaveBeenCalledTimes(1)
    rerender({ state: { ...STATE, tab: 'hybrasyl', canToggleLogPane: true } })
    expect(setMenuState).toHaveBeenLastCalledWith({
      tab: 'hybrasyl',
      canToggleLogPane: true,
      logPaneOpen: false
    })

    act(() => emit({ command: 'go:server' }))
    expect(a.goTab).toHaveBeenCalledWith('server')
  })

  it('on macOS: waits for settings to hydrate', () => {
    bridge('darwin')
    renderHook(() => useAppMenu(false, STATE, actions()))
    expect(window.sparkAPI.setMenuState).not.toHaveBeenCalled()
    expect(window.sparkAPI.onMenuCommand).not.toHaveBeenCalled()
  })

  it.each(['win32', 'linux'])('on %s: does nothing', (platform) => {
    bridge(platform)
    renderHook(() => useAppMenu(true, STATE, actions()))
    expect(window.sparkAPI.setMenuState).not.toHaveBeenCalled()
    expect(window.sparkAPI.onMenuCommand).not.toHaveBeenCalled()
  })

  it('drops the command listener on unmount', () => {
    const { listeners } = bridge('darwin')
    const { unmount } = renderHook(() => useAppMenu(true, STATE, actions()))
    expect(listeners.size).toBe(1)
    unmount()
    expect(listeners.size).toBe(0)
  })
})
