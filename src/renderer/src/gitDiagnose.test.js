import { describe, it, expect, vi, afterEach } from 'vitest'
import { diagnoseAndExplain } from './gitDiagnose.js'

// The folder pickers' git check. A folder pick is a manual action, so it may
// re-ask git after a cached "Command Line Tools missing" (macOS, HTOO-512).

const CLT = 'The Xcode Command Line Tools are missing or broken. Run: xcode-select --install'

function bridge(diag, platform = 'darwin') {
  globalThis.window = { sparkAPI: { platform, diagnoseGitRepo: vi.fn().mockResolvedValue(diag) } }
  return globalThis.window.sparkAPI
}

afterEach(() => {
  delete globalThis.window
})

describe('diagnoseAndExplain', () => {
  it('asks main as a manual action', async () => {
    const api = bridge({ ok: true })
    await diagnoseAndExplain('/repo', { notRepoNoun: 'x' })
    expect(api.diagnoseGitRepo).toHaveBeenCalledWith('/repo', { manual: true })
  })

  it('treats missing Command Line Tools like missing git, and names the command', async () => {
    bridge({ ok: false, reason: 'no_clt', message: CLT })
    const result = await diagnoseAndExplain('/repo', { notRepoNoun: 'x' })
    expect(result).toMatchObject({ accept: true, noGit: true, snack: { severity: 'warning' } })
    expect(result.snack.message).toContain('xcode-select --install')
    // Not the "no .git/ found" text: the folder may well be a repo.
    expect(result.snack.message).not.toMatch(/No \.git/)
  })

  it('on macOS, a missing git points at the Command Line Tools, not Homebrew', async () => {
    bridge({ ok: false, reason: 'no_git' })
    const result = await diagnoseAndExplain('/repo', { notRepoNoun: 'x' })
    expect(result.snack.message).toContain('xcode-select --install')
    expect(result.snack.message).not.toContain('brew install git')
  })
})
