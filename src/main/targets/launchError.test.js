import { describe, it, expect } from 'vitest'
import { describeLaunchError } from './launchError.js'

const err = (code) => new Error(`CreateProcess failed: ${code}`)

describe('describeLaunchError', () => {
  it('maps 740 to an actionable elevation/protected-folder message', () => {
    const msg = describeLaunchError(err(740), 'C:\\DarkAges\\Darkages.exe')
    expect(msg).toContain('error 740')
    expect(msg).toContain('administrator')
    expect(msg).toContain('protected folder')
    expect(msg).not.toContain('CreateProcess failed')
  })

  it('names the protected location when the client path is under one', () => {
    const msg = describeLaunchError(err(740), 'C:\\Users\\me\\OneDrive\\DA\\Darkages.exe')
    expect(msg).toContain('like OneDrive')
  })

  it('omits the "like ..." clause when the path is not obviously protected', () => {
    const msg = describeLaunchError(err(740), 'C:\\DarkAges\\Darkages.exe')
    expect(msg).not.toContain('like ')
  })

  it('maps file-not-found (2/3) to a re-locate message', () => {
    for (const code of [2, 3]) {
      const msg = describeLaunchError(err(code), 'D:\\gone\\Darkages.exe')
      expect(msg).toContain("Couldn't find the Dark Ages client at D:\\gone\\Darkages.exe")
      expect(msg).toContain('Locate Client')
    }
  })

  it('passes through unknown error codes unchanged', () => {
    expect(describeLaunchError(err(5), 'C:\\x.exe')).toBe('CreateProcess failed: 5')
  })

  it('passes through non-CreateProcess errors unchanged', () => {
    expect(describeLaunchError(new Error('Unknown version: 999'), 'C:\\x.exe')).toBe(
      'Unknown version: 999'
    )
  })
})
