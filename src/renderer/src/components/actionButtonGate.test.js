import { describe, it, expect } from 'vitest'
import { hybrasylClientPathConfigured, hybrasylAssetWarning } from './actionButtonGate.js'

describe('hybrasylClientPathConfigured', () => {
  it('returns true in binary mode when binaryPath is set', () => {
    const settings = {
      targets: { hybrasyl: { mode: 'binary', binaryPath: 'C:/client.exe', clientRepoPath: '' } }
    }
    expect(hybrasylClientPathConfigured(settings)).toBe(true)
  })

  it('returns false in binary mode when binaryPath is empty', () => {
    const settings = {
      targets: { hybrasyl: { mode: 'binary', binaryPath: '', clientRepoPath: 'D:/proj.csproj' } }
    }
    expect(hybrasylClientPathConfigured(settings)).toBe(false)
  })

  it('returns true in repo mode when clientRepoPath is set', () => {
    const settings = {
      targets: { hybrasyl: { mode: 'repo', binaryPath: '', clientRepoPath: 'D:/proj.csproj' } }
    }
    expect(hybrasylClientPathConfigured(settings)).toBe(true)
  })

  it('returns false in repo mode when clientRepoPath is empty', () => {
    const settings = {
      targets: { hybrasyl: { mode: 'repo', binaryPath: 'C:/client.exe', clientRepoPath: '' } }
    }
    expect(hybrasylClientPathConfigured(settings)).toBe(false)
  })

  it('returns false when targets.hybrasyl is missing', () => {
    expect(hybrasylClientPathConfigured({})).toBe(false)
    expect(hybrasylClientPathConfigured({ targets: {} })).toBe(false)
  })

  it('returns false when settings is undefined', () => {
    expect(hybrasylClientPathConfigured(undefined)).toBe(false)
    expect(hybrasylClientPathConfigured(null)).toBe(false)
  })

  it('treats unknown mode like binary (the renderer default)', () => {
    const settings = {
      targets: {
        hybrasyl: { mode: 'whatever', binaryPath: 'C:/client.exe', clientRepoPath: '' }
      }
    }
    expect(hybrasylClientPathConfigured(settings)).toBe(true)
  })
})

describe('hybrasylAssetWarning (HTOO-669)', () => {
  const noDats = { ok: false, reason: 'no-dat-files' }

  it('asks before a Hybrasyl launch off Windows when the folder has no .dat files', () => {
    expect(hybrasylAssetWarning('hybrasyl', 'darwin', noDats)).toBe(true)
    expect(hybrasylAssetWarning('hybrasyl', 'linux', noDats)).toBe(true)
  })

  it('does not ask for a folder with game files', () => {
    expect(hybrasylAssetWarning('hybrasyl', 'darwin', { ok: true, datCount: 21 })).toBe(false)
  })

  it("leaves an unset or missing folder to main's error (HTOO-656)", () => {
    expect(hybrasylAssetWarning('hybrasyl', 'darwin', { ok: false, reason: 'unset' })).toBe(false)
    expect(hybrasylAssetWarning('hybrasyl', 'linux', { ok: false, reason: 'missing' })).toBe(false)
  })

  it('does not ask on Windows or for the legacy client', () => {
    expect(hybrasylAssetWarning('hybrasyl', 'win32', noDats)).toBe(false)
    expect(hybrasylAssetWarning('legacy', 'darwin', noDats)).toBe(false)
  })
})
