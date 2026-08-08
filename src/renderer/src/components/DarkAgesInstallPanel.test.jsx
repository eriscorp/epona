// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DarkAgesInstallPanel from './DarkAgesInstallPanel'

const pickInstallDestination = vi.fn()
const pickInstallerFile = vi.fn()
const installFromFile = vi.fn()
const downloadAndInstall = vi.fn()
const cancelInstall = vi.fn()
const onInstallerProgress = vi.fn()

// Captured so a test can push a progress event the way the main process would.
let emitProgress

beforeEach(() => {
  pickInstallDestination.mockReset().mockResolvedValue(null)
  pickInstallerFile.mockReset().mockResolvedValue(null)
  installFromFile.mockReset().mockResolvedValue({ ok: true, filesWritten: 1, bytesWritten: 1 })
  downloadAndInstall.mockReset().mockResolvedValue({ ok: true, filesWritten: 1, bytesWritten: 1 })
  cancelInstall.mockReset().mockResolvedValue({ ok: true })
  onInstallerProgress.mockReset().mockImplementation((cb) => {
    emitProgress = cb
    return () => {
      emitProgress = null
    }
  })
  global.window.sparkAPI = {
    pickInstallDestination,
    pickInstallerFile,
    installFromFile,
    downloadAndInstall,
    cancelInstall,
    onInstallerProgress
  }
})

afterEach(cleanup)

async function chooseDestination(path = '/home/user/DarkAges') {
  pickInstallDestination.mockResolvedValue(path)
  await userEvent.click(screen.getByTestId('installer-destination-browse'))
  await waitFor(() => expect(screen.getByText(path)).toBeTruthy())
}

describe('DarkAgesInstallPanel', () => {
  it('says what it does, and explains itself on hover', async () => {
    // Deliberately terse in the panel. The rationale lives in a tooltip rather than
    // a paragraph, so the controls are what the eye lands on.
    render(<DarkAgesInstallPanel clientPath="" onChange={() => {}} />)
    expect(screen.getByText('Unpack the client files')).toBeTruthy()

    await userEvent.hover(screen.getByTestId('installer-help'))
    await waitFor(() =>
      expect(screen.getByText(/extract the files needed by Brigid/i)).toBeTruthy()
    )
  })

  it('names the folder for what it holds, not for the action', () => {
    // "Archive Storage Directory", not "Install to": the .dat archives are what
    // land there, and the panel no longer claims to install anything.
    render(<DarkAgesInstallPanel clientPath="" onChange={() => {}} />)
    expect(screen.getByText('Archive Storage Directory')).toBeTruthy()
  })

  it('uses the same wording on every platform', () => {
    // An earlier draft branched the copy on isWindows and ended up contradicting
    // its own buttons, which still said "install". One verb everywhere.
    const { unmount } = render(<DarkAgesInstallPanel clientPath="" onChange={() => {}} />)
    const nonWindows = screen.getByTestId('installer-download').textContent
    unmount()

    render(<DarkAgesInstallPanel clientPath="" onChange={() => {}} isWindows />)
    expect(screen.getByTestId('installer-download').textContent).toBe(nonWindows)
    expect(screen.getByText('Unpack the client files')).toBeTruthy()
  })

  it('will not start either route before a destination is chosen', () => {
    // Both routes write a 582 MiB tree somewhere. There is no sensible default
    // for where, so the buttons stay disabled rather than inventing one.
    render(<DarkAgesInstallPanel clientPath="" onChange={() => {}} />)
    expect(screen.getByTestId('installer-download').disabled).toBe(true)
    expect(screen.getByTestId('installer-from-file').disabled).toBe(true)
  })

  it('enables the routes once a destination is picked', async () => {
    render(<DarkAgesInstallPanel clientPath="" onChange={() => {}} />)
    await chooseDestination()
    expect(screen.getByTestId('installer-download').disabled).toBe(false)
    expect(screen.getByTestId('installer-from-file').disabled).toBe(false)
  })

  it('downloads into the chosen destination and adopts it as clientPath', async () => {
    const onChange = vi.fn()
    downloadAndInstall.mockResolvedValue({
      ok: true,
      filesWritten: 101,
      bytesWritten: 610802176,
      destinationDir: '/home/user/DarkAges'
    })
    render(<DarkAgesInstallPanel clientPath="" onChange={onChange} />)
    await chooseDestination()

    await userEvent.click(screen.getByTestId('installer-download'))

    expect(downloadAndInstall).toHaveBeenCalledWith({ destinationDir: '/home/user/DarkAges' })
    // The point of the whole flow: a finished install leaves the tab configured.
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ clientPath: '/home/user/DarkAges' })
    )
    expect(screen.getByTestId('installer-result').textContent).toMatch(/Installed 101 files/)
  })

  it('unpacks a copy the user already has, without downloading', async () => {
    const onChange = vi.fn()
    pickInstallerFile.mockResolvedValue('/downloads/DarkAges741single.exe')
    installFromFile.mockResolvedValue({
      ok: true,
      filesWritten: 101,
      bytesWritten: 610802176,
      destinationDir: '/home/user/DarkAges'
    })
    render(<DarkAgesInstallPanel clientPath="" onChange={onChange} />)
    await chooseDestination()

    await userEvent.click(screen.getByTestId('installer-from-file'))

    expect(installFromFile).toHaveBeenCalledWith({
      installerPath: '/downloads/DarkAges741single.exe',
      destinationDir: '/home/user/DarkAges'
    })
    expect(downloadAndInstall).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ clientPath: '/home/user/DarkAges' })
    )
  })

  it('does nothing when the installer picker is cancelled', async () => {
    pickInstallerFile.mockResolvedValue(null)
    render(<DarkAgesInstallPanel clientPath="" onChange={() => {}} />)
    await chooseDestination()

    await userEvent.click(screen.getByTestId('installer-from-file'))
    expect(installFromFile).not.toHaveBeenCalled()
    expect(screen.queryByTestId('installer-result')).toBeNull()
  })

  it('shows progress as the main process reports it', async () => {
    let settle
    downloadAndInstall.mockReturnValue(new Promise((r) => (settle = r)))
    render(<DarkAgesInstallPanel clientPath="" onChange={() => {}} />)
    await chooseDestination()
    await userEvent.click(screen.getByTestId('installer-download'))

    await act(async () => {
      emitProgress({ phase: 'download', bytesDone: 1048576, totalBytes: 2097152 })
    })
    expect(screen.getByTestId('installer-progress').textContent).toBe(
      'Downloading 1.0 MiB of 2.0 MiB'
    )

    await act(async () => {
      emitProgress({ phase: 'extract', filesDone: 5, filesTotal: 101, bytesDone: 2048 })
    })
    expect(screen.getByTestId('installer-progress').textContent).toMatch(/Unpacking 5 of 101 files/)

    await act(async () => settle({ ok: true, filesWritten: 101, bytesWritten: 2048 }))
  })

  it('offers a cancel control only while an install is running', async () => {
    let settle
    downloadAndInstall.mockReturnValue(new Promise((r) => (settle = r)))
    render(<DarkAgesInstallPanel clientPath="" onChange={() => {}} />)
    await chooseDestination()

    expect(screen.queryByTestId('installer-cancel')).toBeNull()
    await userEvent.click(screen.getByTestId('installer-download'))
    expect(screen.getByTestId('installer-cancel')).toBeTruthy()

    await userEvent.click(screen.getByTestId('installer-cancel'))
    expect(cancelInstall).toHaveBeenCalled()

    await act(async () => settle({ ok: false, reason: 'cancelled' }))
    expect(screen.queryByTestId('installer-cancel')).toBeNull()
  })

  it('reports a cancellation without claiming an error', async () => {
    downloadAndInstall.mockResolvedValue({ ok: false, reason: 'cancelled' })
    const onChange = vi.fn()
    render(<DarkAgesInstallPanel clientPath="" onChange={onChange} />)
    await chooseDestination()

    await userEvent.click(screen.getByTestId('installer-download'))
    await waitFor(() =>
      expect(screen.getByTestId('installer-result').textContent).toMatch(/cancelled/i)
    )
    expect(onChange).not.toHaveBeenCalled()
  })

  it('shows why a failed install failed, and does not adopt the folder', async () => {
    // Pointing clientPath at a folder we already know is bad would leave the tab
    // claiming a client that does not work.
    const onChange = vi.fn()
    installFromFile.mockResolvedValue({
      ok: false,
      reason: 'not-an-installer',
      message: 'That file is not a Dark Ages installer.'
    })
    pickInstallerFile.mockResolvedValue('/downloads/holiday.jpg')
    render(<DarkAgesInstallPanel clientPath="" onChange={onChange} />)
    await chooseDestination()

    await userEvent.click(screen.getByTestId('installer-from-file'))
    await waitFor(() =>
      expect(screen.getByTestId('installer-result').textContent).toMatch(
        /not a Dark Ages installer/
      )
    )
    expect(onChange).not.toHaveBeenCalled()
  })

  describe('on Windows', () => {
    it('points clientPath at the executable, not the folder', async () => {
      // clientPath holds a FILE on Windows and a DIRECTORY everywhere else.
      // Writing the folder here would leave the Legacy tab pointing at a directory
      // where it expects an exe, and the launch would fail somewhere that does not
      // name this setting.
      const onChange = vi.fn()
      installFromFile.mockResolvedValue({
        ok: true,
        filesWritten: 101,
        bytesWritten: 610802176,
        destinationDir: 'C:\\Games\\DarkAges',
        executablePath: 'C:\\Games\\DarkAges\\Darkages.exe'
      })
      pickInstallerFile.mockResolvedValue('C:\\Downloads\\DarkAges741single.exe')
      render(<DarkAgesInstallPanel clientPath="" onChange={onChange} isWindows />)
      await chooseDestination('C:\\Games\\DarkAges')

      await userEvent.click(screen.getByTestId('installer-from-file'))

      await waitFor(() =>
        expect(onChange).toHaveBeenCalledWith({
          clientPath: 'C:\\Games\\DarkAges\\Darkages.exe'
        })
      )
    })

    it('falls back to the folder when no executable was unpacked', async () => {
      // Better than writing null and silently clearing the setting.
      const onChange = vi.fn()
      downloadAndInstall.mockResolvedValue({
        ok: true,
        filesWritten: 100,
        bytesWritten: 1024,
        destinationDir: 'C:\\Games\\DarkAges',
        executablePath: null
      })
      render(<DarkAgesInstallPanel clientPath="" onChange={onChange} isWindows />)
      await chooseDestination('C:\\Games\\DarkAges')

      await userEvent.click(screen.getByTestId('installer-download'))

      await waitFor(() =>
        expect(onChange).toHaveBeenCalledWith({ clientPath: 'C:\\Games\\DarkAges' })
      )
    })
  })

  it('keeps writing the folder on macOS and Linux even if an exe was found', async () => {
    // The Hybrasyl client reads assets from the DIRECTORY on these platforms, and
    // the retail tree does contain Darkages.exe — which is useless there.
    const onChange = vi.fn()
    downloadAndInstall.mockResolvedValue({
      ok: true,
      filesWritten: 101,
      bytesWritten: 1024,
      destinationDir: '/home/user/DarkAges',
      executablePath: '/home/user/DarkAges/Darkages.exe'
    })
    render(<DarkAgesInstallPanel clientPath="" onChange={onChange} />)
    await chooseDestination('/home/user/DarkAges')

    await userEvent.click(screen.getByTestId('installer-download'))

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ clientPath: '/home/user/DarkAges' })
    )
  })

  it('unsubscribes from progress when it goes away', async () => {
    const { unmount } = render(<DarkAgesInstallPanel clientPath="" onChange={() => {}} />)
    expect(emitProgress).toBeTypeOf('function')
    unmount()
    expect(emitProgress).toBeNull()
  })
})
