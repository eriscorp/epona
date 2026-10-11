import { describe, it, expect } from 'vitest'
import {
  isCltFailure,
  classifyCredentialFailure,
  credentialMessage,
  CLT_MESSAGE
} from './gitFailure.js'

// Real text. The first is the shim on a Mac without the tools (Balor, a fresh
// Mac mini, 2026-09-30). The second is the shim after a macOS upgrade removed
// them; its `xcrun: error: invalid ... DEVELOPER_DIR path` sibling was captured
// on macOS 27 for WP98.
const NO_CLT = 'xcode-select: note: No developer tools were found, requesting install.\n'
const BROKEN_CLT =
  'xcrun: error: invalid active developer path (/Library/Developer/CommandLineTools), missing xcrun at: /Library/Developer/CommandLineTools/usr/bin/xcrun\n'

describe('isCltFailure', () => {
  it('names both shim failures on macOS', () => {
    expect(isCltFailure(NO_CLT, 'darwin')).toBe(true)
    expect(isCltFailure(BROKEN_CLT, 'darwin')).toBe(true)
  })

  it('is false elsewhere, and for other errors', () => {
    expect(isCltFailure(NO_CLT, 'linux')).toBe(false)
    expect(isCltFailure(NO_CLT, 'win32')).toBe(false)
    expect(isCltFailure('fatal: not a git repository', 'darwin')).toBe(false)
    // A DEVELOPER_DIR the user set is their setting, not missing tools.
    expect(isCltFailure('xcrun: error: missing DEVELOPER_DIR path: /nonexistent', 'darwin')).toBe(
      false
    )
  })

  it('tells the user the command, not "install git"', () => {
    expect(CLT_MESSAGE).toContain('xcode-select --install')
    expect(CLT_MESSAGE).not.toMatch(/git is not installed/i)
  })
})

describe('classifyCredentialFailure', () => {
  it.each([
    [
      'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.',
      'publickey'
    ],
    ['Host key verification failed.\nfatal: Could not read from remote repository.', 'host-key'],
    [
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      'no-prompt'
    ],
    ['fatal: terminal prompts disabled', 'no-prompt']
  ])('%s', (stderr, kind) => {
    expect(classifyCredentialFailure(stderr)).toBe(kind)
  })

  it('is null for a failure that is not about credentials', () => {
    expect(classifyCredentialFailure('fatal: unable to access: Could not resolve host')).toBeNull()
  })

  it('names the app in its sentence', () => {
    expect(credentialMessage('publickey', 'Mabon')).toContain('available to Mabon')
    expect(credentialMessage('no-prompt', 'Mabon')).toContain('gh auth setup-git')
  })
})
