import { describe, it, expect } from 'vitest'
import {
  isRemoteSession,
  detectRemoteSession,
  clampWindowSize,
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
