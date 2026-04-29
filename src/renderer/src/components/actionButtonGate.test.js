import { describe, it, expect } from 'vitest'
import { hybrasylClientPathConfigured } from './actionButtonGate.js'

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
