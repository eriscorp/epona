// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LegacyAssetsPanel from './LegacyAssetsPanel'

// The first renderer test in the repo, and the reason vitest.config.js keeps
// `environment: 'node'` as the default: main-process tests outnumber these and
// have no business paying for a DOM. The docblock above opts this file in.
// Every later renderer test needs the same line.

const inspectAssetDir = vi.fn()
const pickDirectory = vi.fn()
// The panel now embeds DarkAgesInstallPanel (HTOO-288), which subscribes to
// installer progress on mount. Stubbed here rather than mocking the child away:
// these tests are about the panel as the tab actually renders it, and a bridge
// method the child needs but the preload does not expose should fail them.
const onInstallerProgress = vi.fn()

beforeEach(() => {
  inspectAssetDir.mockReset().mockResolvedValue({ ok: false, reason: 'unset' })
  pickDirectory.mockReset().mockResolvedValue(null)
  onInstallerProgress.mockReset().mockReturnValue(() => {})
  global.window.sparkAPI = { inspectAssetDir, pickDirectory, onInstallerProgress }
})

afterEach(cleanup)

describe('LegacyAssetsPanel', () => {
  it('says why the tab exists on a platform that cannot launch', async () => {
    render(<LegacyAssetsPanel clientPath="" onChange={() => {}} />)
    // The panel has to answer "why am I looking at this" without the user
    // going to the docs: the Hybrasyl client reads its art from this folder.
    expect(screen.getByText(/Hybrasyl client reads its graphics/i)).toBeTruthy()
  })

  it('shows the configured folder and a Found chip once the check passes', async () => {
    inspectAssetDir.mockResolvedValue({ ok: true, datCount: 7 })
    render(<LegacyAssetsPanel clientPath="/home/user/DarkAges" onChange={() => {}} />)

    expect(screen.getByText('/home/user/DarkAges')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('asset-status-chip').textContent).toBe('Found'))
    expect(screen.getByTestId('asset-status-detail').textContent).toBe(
      '7 Dark Ages data files found'
    )
  })

  it('reports a folder that has gone away rather than staying silent', async () => {
    inspectAssetDir.mockResolvedValue({ ok: false, reason: 'missing' })
    render(<LegacyAssetsPanel clientPath="/gone" onChange={() => {}} />)

    await waitFor(() =>
      expect(screen.getByTestId('asset-status-chip').textContent).toBe('Not found')
    )
    expect(screen.getByTestId('asset-status-detail').textContent).toMatch(/no longer exists/i)
  })

  it('writes the picked folder to clientPath', async () => {
    const onChange = vi.fn()
    pickDirectory.mockResolvedValue('/home/user/DarkAges')
    render(<LegacyAssetsPanel clientPath="" onChange={onChange} />)

    await userEvent.click(screen.getByTestId('asset-folder-browse'))
    // Same setting the Windows panel uses for Dark Ages.exe — one field, two
    // meanings, decided deliberately in HTOO-296.
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ clientPath: '/home/user/DarkAges' })
    )
  })

  it('changes nothing when the picker is cancelled', async () => {
    const onChange = vi.fn()
    pickDirectory.mockResolvedValue(null)
    render(<LegacyAssetsPanel clientPath="/home/user/DarkAges" onChange={onChange} />)

    await userEvent.click(screen.getByTestId('asset-folder-browse'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('re-checks when the path changes', async () => {
    const { rerender } = render(<LegacyAssetsPanel clientPath="/first" onChange={() => {}} />)
    await waitFor(() => expect(inspectAssetDir).toHaveBeenCalledWith('/first'))

    rerender(<LegacyAssetsPanel clientPath="/second" onChange={() => {}} />)
    await waitFor(() => expect(inspectAssetDir).toHaveBeenCalledWith('/second'))
  })

  it('does not set state from a check that resolves after unmount', async () => {
    // The classic effect leak: pick a folder, switch tabs before the check
    // returns, and React warns about updating an unmounted component.
    let resolveCheck
    inspectAssetDir.mockReturnValue(new Promise((r) => (resolveCheck = r)))
    const { unmount } = render(<LegacyAssetsPanel clientPath="/slow" onChange={() => {}} />)

    unmount()
    resolveCheck({ ok: true, datCount: 3 })
    await Promise.resolve()
    expect(screen.queryByTestId('asset-status-chip')).toBeNull()
  })
})
