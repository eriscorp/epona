// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { themesByName, EPONA_WORDMARK_SIZE } from '../themes/eponaThemes'
import { appIdentity } from '../../../shared/appIdentity.js'
import { useSettings } from '../store/settingsStore.js'
import AppTitleBar from './AppTitleBar'

// Epona's wiring of the house TitleBar: its name, its icon, its theme and the
// preload bridge (`window.sparkAPI`). The template's AppTitleBar test, adapted.
//
// The padding is NOT asserted here. jsdom does not apply media queries, so a
// `toHaveStyle({ paddingLeft })` passes against a layout no build renders.
// e2e/title-bar.spec.js reads it from the built app.

function mount(platform = 'win32') {
  window.sparkAPI = { platform, minimizeWindow: vi.fn(), closeWindow: vi.fn() }
  const view = render(
    <ThemeProvider theme={themesByName.hybrasyl}>
      <AppTitleBar />
    </ThemeProvider>
  )
  return { ...view, api: window.sparkAPI }
}

beforeEach(() => {
  useSettings.setState((s) => ({ settings: { ...s.settings, theme: 'hybrasyl' } }))
})

afterEach(() => {
  cleanup()
  delete window.sparkAPI
})

describe('AppTitleBar', () => {
  it("shows the app's product name and its icon", () => {
    const { container } = mount()
    expect(screen.getByTestId('title-bar').textContent).toContain(appIdentity.productName)
    expect(container.querySelector('img')).not.toBeNull()
  })

  it('draws two window buttons: the window has a fixed size, so no Maximize', () => {
    mount()
    const labels = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))
    expect(labels).toEqual(['Minimize', 'Close'])
  })

  it('wires the window buttons to the preload bridge', async () => {
    const user = userEvent.setup()
    const { api } = mount()
    await user.click(screen.getByRole('button', { name: 'Minimize' }))
    expect(api.minimizeWindow).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(api.closeWindow).toHaveBeenCalledOnce()
  })

  it('takes the chrome of the theme in the settings', () => {
    // mundanes is a plain theme: no keyline on the wordmark. hybrasyl keylines it.
    mount()
    const shadow = () => getComputedStyle(screen.getByText(appIdentity.productName)).textShadow
    // jsdom 31 serializes the colour (`rgb(0, 0, 0)`); jsdom 29 kept `#000`.
    expect(shadow()).toMatch(/#000|rgb\(0, 0, 0\) 1px 1px/)
    cleanup()
    useSettings.setState((s) => ({ settings: { ...s.settings, theme: 'mundanes' } }))
    mount()
    expect(shadow()).not.toMatch(/#000|rgb\(0, 0, 0\)/)
  })

  it("draws the wordmark at Epona's size, not the house 1.5rem (Sabrael, 2026-10-24)", () => {
    mount()
    // jsdom 31 computes rem to px at the 16px root; jsdom 29 kept rem.
    const px = `${Number.parseFloat(EPONA_WORDMARK_SIZE) * 16}px`
    expect([EPONA_WORDMARK_SIZE, px]).toContain(
      getComputedStyle(screen.getByText(appIdentity.productName)).fontSize
    )
  })

  it('on macOS draws no window buttons, no logo and no name', () => {
    const { container } = mount('darwin')
    expect(screen.getByTestId('title-bar')).toBeTruthy()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.queryByText(appIdentity.productName)).toBeNull()
  })
})
