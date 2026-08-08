import { describe, it, expect } from 'vitest'
import {
  isRemoteSession,
  detectRemoteSession,
  clampWindowSize,
  resolveGpuOverride,
  shouldDisableHardwareAcceleration,
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
})

describe('detectRemoteSession', () => {
  it('reads platform and SESSIONNAME off the injected process', () => {
    expect(detectRemoteSession({ platform: 'win32', env: { SESSIONNAME: 'RDP-Tcp#2' } })).toBe(true)
    expect(detectRemoteSession({ platform: 'win32', env: { SESSIONNAME: 'Console' } })).toBe(false)
  })

  it('tolerates a process with no env', () => {
    expect(detectRemoteSession({ platform: 'win32' })).toBe(false)
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
})
