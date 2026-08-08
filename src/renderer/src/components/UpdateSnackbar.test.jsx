// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UpdateSnackbar from './UpdateSnackbar'

// The behaviours worth pinning are the quiet ones: this component renders
// nothing far more often than it renders something, and every one of those
// paths is a case where showing a banner would be wrong.

const DISMISS_KEY = 'epona:updateDismissedVersion'

const available = {
  ok: true,
  updateAvailable: true,
  currentVersion: '2.7.2',
  latestVersion: 'v2.8.0',
  releaseUrl: 'https://github.com/eriscorp/epona/releases/tag/v2.8.0'
}

function mount(result) {
  global.window.sparkAPI = {
    checkForUpdates: typeof result === 'function' ? result : vi.fn().mockResolvedValue(result)
  }
  return render(<UpdateSnackbar />)
}

// The check is deferred by CHECK_DELAY_MS; run the timer and let the promise
// it starts settle.
async function settle() {
  await act(async () => {
    vi.runAllTimers()
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('UpdateSnackbar', () => {
  it('shows the version pair and a release link when an update is available', async () => {
    mount(available)
    await settle()
    expect(screen.getByText(/Epona v2\.8\.0 is available \(you have 2\.7\.2\)/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /view release/i }).getAttribute('href')).toBe(
      available.releaseUrl
    )
  })

  it('renders nothing before the delayed check resolves', () => {
    const { container } = mount(available)
    // No flash of an empty banner while the request is in flight.
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when the check failed', async () => {
    const { container } = mount({ ok: false, error: 'GitHub responded with 403' })
    await settle()
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when the running version is current', async () => {
    const { container } = mount({ ok: true, updateAvailable: false, latestVersion: 'v2.7.2' })
    await settle()
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when the bridge throws', async () => {
    const { container } = mount(() => Promise.reject(new Error('bridge gone')))
    await settle()
    expect(container.firstChild).toBeNull()
  })

  it('stays quiet for a version already dismissed', async () => {
    localStorage.setItem(DISMISS_KEY, 'v2.8.0')
    const { container } = mount(available)
    await settle()
    expect(container.firstChild).toBeNull()
  })

  it('still speaks up for a version newer than the dismissed one', async () => {
    // Dismissal is per-version, not "stop telling me about updates".
    localStorage.setItem(DISMISS_KEY, 'v2.7.9')
    mount(available)
    await settle()
    expect(screen.getByText(/Epona v2\.8\.0 is available/)).toBeTruthy()
  })

  it('records the dismissal when closed', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mount(available)
    await settle()
    await user.click(screen.getByRole('button', { name: /dismiss update notification/i }))
    expect(localStorage.getItem(DISMISS_KEY)).toBe('v2.8.0')
    expect(screen.queryByText(/is available/)).toBeNull()
  })

  it('does not check at all if unmounted within the delay', async () => {
    const check = vi.fn().mockResolvedValue(available)
    const { unmount } = mount(check)
    unmount()
    await settle()
    // The effect cleanup clears the timer, so a window closed immediately after
    // launch never spends the round trip.
    expect(check).not.toHaveBeenCalled()
  })
})
