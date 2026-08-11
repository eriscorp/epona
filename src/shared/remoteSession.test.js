import { describe, it, expect } from 'vitest'
import {
  isRemoteSession,
  detectRemoteSession,
  clampWindowSize,
  resolveGpuOverride,
  shouldDisableHardwareAcceleration,
  REMOTE_SESSION_CSS,
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT
} from './remoteSession.js'

describe('isRemoteSession', () => {
  it('detects an RDP session name', () => {
    expect(isRemoteSession({ platform: 'win32', sessionName: 'RDP-Tcp#0' })).toBe(true)
    expect(isRemoteSession({ platform: 'win32', sessionName: 'RDP-Tcp#17' })).toBe(true)
  })

  it('treats a local console session as not remote', () => {
    expect(isRemoteSession({ platform: 'win32', sessionName: 'Console' })).toBe(false)
  })

  it('is case-insensitive about Console', () => {
    // Windows reports 'Console', but nothing documents the casing as stable.
    expect(isRemoteSession({ platform: 'win32', sessionName: 'CONSOLE' })).toBe(false)
    expect(isRemoteSession({ platform: 'win32', sessionName: 'console' })).toBe(false)
  })

  it('treats an absent or empty SESSIONNAME as local', () => {
    // Unset happens in service and scheduled-task launch contexts. Guessing
    // "remote" there would disable the GPU for someone sitting at the machine.
    expect(isRemoteSession({ platform: 'win32', sessionName: undefined })).toBe(false)
    expect(isRemoteSession({ platform: 'win32', sessionName: '' })).toBe(false)
  })

  it('is false off Windows regardless of the variable', () => {
    // SESSIONNAME is a Windows concept; anything named that elsewhere is noise.
    expect(isRemoteSession({ platform: 'darwin', sessionName: 'RDP-Tcp#0' })).toBe(false)
    expect(isRemoteSession({ platform: 'linux', sessionName: 'RDP-Tcp#0' })).toBe(false)
  })

  it('survives being called with nothing', () => {
    expect(isRemoteSession()).toBe(false)
    expect(isRemoteSession({})).toBe(false)
  })

  // The bug that made the whole remote-session adaptation inert in practice.
  describe('when SM_REMOTESESSION is available it outranks SESSIONNAME', () => {
    it('believes a live "remote" over a stale Console — the reconnect case', () => {
      // Observed on a real machine: a session opened at the console and later
      // RECONNECTED over RDP keeps SESSIONNAME=Console forever, because Windows
      // writes it at logon and never revises it. `query session` said
      // rdp-tcp#0 Active and Electron reported the 1280x960 RDP virtual
      // display, while SESSIONNAME still said Console and CLIENTNAME was unset.
      // That is what anyone who leaves a machine logged in and connects to it
      // later gets, so this path was doing nothing for exactly those users.
      expect(
        isRemoteSession({ platform: 'win32', sessionName: 'Console', systemRemoteSession: true })
      ).toBe(true)
    })

    it('believes a live "not remote" over an RDP-looking SESSIONNAME', () => {
      // Authoritative in both directions, or it is not authoritative.
      expect(
        isRemoteSession({ platform: 'win32', sessionName: 'RDP-Tcp#0', systemRemoteSession: false })
      ).toBe(false)
    })

    it('falls back to SESSIONNAME when the native answer is missing', () => {
      // null/undefined means "no opinion" — an unloadable addon must degrade to
      // the previous behaviour, not to "never remote".
      for (const absent of [null, undefined]) {
        expect(
          isRemoteSession({
            platform: 'win32',
            sessionName: 'RDP-Tcp#0',
            systemRemoteSession: absent
          })
        ).toBe(true)
        expect(
          isRemoteSession({
            platform: 'win32',
            sessionName: 'Console',
            systemRemoteSession: absent
          })
        ).toBe(false)
      }
    })

    it('is still false off Windows even if something answers true', () => {
      expect(
        isRemoteSession({ platform: 'darwin', sessionName: 'Console', systemRemoteSession: true })
      ).toBe(false)
    })
  })
})

describe('detectRemoteSession', () => {
  it('reads platform and SESSIONNAME off the injected process', () => {
    expect(detectRemoteSession({ platform: 'win32', env: { SESSIONNAME: 'RDP-Tcp#2' } })).toBe(true)
    expect(detectRemoteSession({ platform: 'win32', env: { SESSIONNAME: 'Console' } })).toBe(false)
  })

  it('tolerates a process with no env', () => {
    expect(detectRemoteSession({ platform: 'win32' })).toBe(false)
  })

  it('passes the injected native answer through, and defaults it to "no opinion"', () => {
    const consoleProc = { platform: 'win32', env: { SESSIONNAME: 'Console' } }
    expect(detectRemoteSession(consoleProc, true)).toBe(true)
    expect(detectRemoteSession(consoleProc)).toBe(false) // default: env var only
  })
})

describe('REMOTE_SESSION_CSS', () => {
  it('neutralises the two blur effects that cost the most under software compositing', () => {
    // backdrop-filter: four themes put blur(2px) on MuiPaper.root, and Paper
    // backs Card/Dialog/Accordion/Menu — a readback and blur of everything
    // behind most surfaces, on every repaint.
    expect(REMOTE_SESSION_CSS).toMatch(/backdrop-filter:\s*none\s*!important/)
    expect(REMOTE_SESSION_CSS).toMatch(/-webkit-backdrop-filter:\s*none\s*!important/)
    // text-shadow: a blur radius on EVERY GLYPH, via MuiCssBaseline.body. This
    // is the one that was visible as "very squiggly" text over RDP.
    expect(REMOTE_SESSION_CSS).toMatch(/text-shadow:\s*none\s*!important/)
  })

  it('forces grayscale antialiasing, since there is no subpixel layout to exploit', () => {
    expect(REMOTE_SESSION_CSS).toMatch(/-webkit-font-smoothing:\s*antialiased/)
  })

  it('leaves box-shadow alone, on purpose', () => {
    // The theme shadows are mostly zero-blur offsets drawing carved panel
    // edges. Stripping them restyles the app and saves no rasterisation, so a
    // future "while we're here" addition here would be a regression.
    expect(REMOTE_SESSION_CSS).not.toMatch(/[^-]box-shadow/)
  })
})

describe('clampWindowSize', () => {
  const roomy = { width: 1920, height: 1080 }

  it('passes a size through when it fits', () => {
    expect(clampWindowSize({ width: 840, height: 800, workAreaSize: roomy })).toEqual({
      width: 840,
      height: 800
    })
  })

  it('clamps down to the work area', () => {
    // The original reason for the clamp: 800px does not fit a 1080p panel at
    // 150% scaling, and asking for more than fits leaves the OS to clamp us.
    expect(
      clampWindowSize({ width: 840, height: 800, workAreaSize: { width: 1280, height: 662 } })
    ).toEqual({ width: 840, height: 662 })
  })

  it('never returns a size below the floor, however small the work area', () => {
    // The bug this fixes: a degenerate work area collapsed the target, and the
    // result was locked into BOTH min and max, pinning the window at ~100px
    // with no way back.
    const result = clampWindowSize({
      width: 840,
      height: 800,
      workAreaSize: { width: 100, height: 80 }
    })
    expect(result).toEqual({ width: MIN_WINDOW_WIDTH, height: MIN_WINDOW_HEIGHT })
  })

  it('ignores a work area that is zero, negative, NaN or missing', () => {
    const expected = { width: 840, height: 800 }
    expect(
      clampWindowSize({ width: 840, height: 800, workAreaSize: { width: 0, height: 0 } })
    ).toEqual(expected)
    expect(clampWindowSize({ width: 840, height: 800, workAreaSize: undefined })).toEqual(expected)
    expect(
      clampWindowSize({ width: 840, height: 800, workAreaSize: { width: NaN, height: NaN } })
    ).toEqual(expected)
  })

  it('floors a requested size that is itself degenerate', () => {
    expect(clampWindowSize({ width: 1, height: 1, workAreaSize: roomy })).toEqual({
      width: MIN_WINDOW_WIDTH,
      height: MIN_WINDOW_HEIGHT
    })
  })
})

describe('resolveGpuOverride', () => {
  it('reads unset and empty as "decide by detection"', () => {
    expect(resolveGpuOverride(undefined)).toBe(null)
    expect(resolveGpuOverride('')).toBe(null)
  })

  it('reads 0 as "force acceleration back on"', () => {
    expect(resolveGpuOverride('0')).toBe(false)
  })

  it('reads anything else as "force software rendering"', () => {
    expect(resolveGpuOverride('1')).toBe(true)
    expect(resolveGpuOverride('true')).toBe(true)
    expect(resolveGpuOverride('yes')).toBe(true)
  })

  it('does not fall through to detection on an unrecognised value', () => {
    // The failure this prevents: a typo reading as an override that silently
    // did nothing, which is indistinguishable from the override not working.
    expect(resolveGpuOverride('maybe')).toBe(true)
    expect(resolveGpuOverride('00')).toBe(true)
  })
})

describe('shouldDisableHardwareAcceleration', () => {
  const remote = { platform: 'win32', env: { SESSIONNAME: 'RDP-Tcp#2' } }
  const local = { platform: 'win32', env: { SESSIONNAME: 'Console' } }

  it('falls back to detection when the override is unset', () => {
    expect(shouldDisableHardwareAcceleration(remote)).toBe(true)
    expect(shouldDisableHardwareAcceleration(local)).toBe(false)
  })

  it('forces software rendering on a local machine when asked', () => {
    // This is how the remote branch gets exercised without an RDP session.
    expect(
      shouldDisableHardwareAcceleration({
        platform: 'win32',
        env: { SESSIONNAME: 'Console', EPONA_DISABLE_GPU: '1' }
      })
    ).toBe(true)
  })

  it('forces acceleration back on in a remote session when asked', () => {
    // The user's only recourse if detection is wrong for them, since there is
    // deliberately no setting.
    expect(
      shouldDisableHardwareAcceleration({
        platform: 'win32',
        env: { SESSIONNAME: 'RDP-Tcp#2', EPONA_DISABLE_GPU: '0' }
      })
    ).toBe(false)
  })

  it('works on a platform detection never fires for', () => {
    expect(shouldDisableHardwareAcceleration({ platform: 'linux', env: {} })).toBe(false)
    expect(
      shouldDisableHardwareAcceleration({ platform: 'linux', env: { EPONA_DISABLE_GPU: '1' } })
    ).toBe(true)
  })

  it('leaves isRemoteSession telling the truth', () => {
    // The override must not leak into the predicate that makes a claim about
    // the world — that is why it lives in this function and not that one.
    expect(isRemoteSession({ platform: 'win32', sessionName: 'Console' })).toBe(false)
  })

  it('disables acceleration on a reconnected session that still claims Console', () => {
    // The end-to-end shape of the real bug: without the native signal this
    // returns false and app.disableHardwareAcceleration() is never called, so
    // the whole remote adaptation — flag and CSS both — silently does nothing.
    expect(shouldDisableHardwareAcceleration(local)).toBe(false)
    expect(shouldDisableHardwareAcceleration(local, true)).toBe(true)
  })

  it('still lets the override win over the native signal', () => {
    // EPONA_DISABLE_GPU is the last word, or it is not an escape hatch.
    expect(shouldDisableHardwareAcceleration({ ...local, env: { ...local.env } }, true)).toBe(true)
    expect(
      shouldDisableHardwareAcceleration(
        { platform: 'win32', env: { SESSIONNAME: 'Console', EPONA_DISABLE_GPU: '0' } },
        true
      )
    ).toBe(false)
  })
})
