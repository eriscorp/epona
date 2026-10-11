// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import TitleBar from './TitleBar'

// The title bar by platform. On macOS it is an empty drag region: the native
// stoplights sit in it, with no window buttons, no logo and no name (the house
// macOS chrome). Elsewhere it draws the logo, the name and two buttons.
//
// The padding is NOT asserted here. jsdom does not apply media queries, so a
// `toHaveStyle({ paddingLeft })` passes against a layout no build renders.
// e2e/title-bar.spec.js reads it from the built app.

function mount(platform) {
  global.window.sparkAPI = { platform, minimizeWindow() {}, closeWindow() {} }
  return render(<TitleBar />)
}

afterEach(() => {
  cleanup()
})

describe('TitleBar', () => {
  it('on macOS draws no window buttons, no logo and no name', () => {
    const { container } = mount('darwin')
    expect(screen.getByTestId('title-bar')).toBeTruthy()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.queryByTestId('app-title')).toBeNull()
    expect(screen.queryByText('Epona')).toBeNull()
  })

  it('on Windows draws the logo, the name and the two window buttons', () => {
    const { container } = mount('win32')
    expect(container.querySelector('img')).not.toBeNull()
    expect(screen.getByTestId('app-title').textContent).toBe('Epona')
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })
})
