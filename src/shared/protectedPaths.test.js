import { describe, it, expect } from 'vitest'
import { detectProtectedLocation } from './protectedPaths.js'

describe('detectProtectedLocation', () => {
  it('flags OneDrive personal folders', () => {
    expect(detectProtectedLocation('C:\\Users\\me\\OneDrive\\Dark Ages\\Darkages.exe')).toBe(
      'OneDrive'
    )
  })

  it('flags OneDrive business folders (OneDrive - Company)', () => {
    expect(detectProtectedLocation('C:\\Users\\me\\OneDrive - Eris Corp\\DA\\Darkages.exe')).toBe(
      'OneDrive'
    )
  })

  it('flags Program Files and Program Files (x86)', () => {
    expect(detectProtectedLocation('C:\\Program Files\\Dark Ages\\Darkages.exe')).toBe(
      'Program Files'
    )
    expect(detectProtectedLocation('C:\\Program Files (x86)\\Dark Ages\\Darkages.exe')).toBe(
      'Program Files'
    )
  })

  it('flags the Windows folder', () => {
    expect(detectProtectedLocation('C:\\Windows\\System32\\Darkages.exe')).toBe(
      'the Windows folder'
    )
  })

  it('matches forward-slash and mixed-case paths', () => {
    expect(detectProtectedLocation('c:/users/me/onedrive/da/darkages.exe')).toBe('OneDrive')
  })

  it('returns null for a normal user-writable path', () => {
    expect(detectProtectedLocation('C:\\DarkAges\\Darkages.exe')).toBeNull()
    expect(detectProtectedLocation('D:\\Games\\Dark Ages\\Darkages.exe')).toBeNull()
  })

  it('returns null for empty/undefined input', () => {
    expect(detectProtectedLocation('')).toBeNull()
    expect(detectProtectedLocation(undefined)).toBeNull()
  })

  it('does not flag a folder merely named "onedrive-backup" without a trailing segment', () => {
    // The exe path always has a filename after the folder, so a bare match on a
    // final segment shouldn't trigger; a plain unrelated path stays null.
    expect(detectProtectedLocation('C:\\myonedriveclone\\da.exe')).toBeNull()
  })
})
