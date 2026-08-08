import { describe, it, expect, vi, beforeEach } from 'vitest'

// Module-level mocks must be declared before the imports that consume them.
// These tests exercise launch()'s cleanup ladder for repo-mode failures —
// the pure-function tests in serverTarget.test.js cover the rest.
vi.mock('../worktreeManager.js', () => ({
  ensureWorktree: vi.fn(),
  releaseWorktree: vi.fn().mockResolvedValue(undefined)
}))
// Only the filesystem half is mocked. claimBuildProps/releaseBuildProps are
// pure in-memory bookkeeping, and the point of the collision test below is
// that launch() consults the real ones.
vi.mock('../buildProps.js', async (importActual) => ({
  ...(await importActual()),
  writeBuildProps: vi.fn().mockResolvedValue(undefined),
  removeBuildProps: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('../redisProbe.js', () => ({
  // Default: redis target unreachable. Skipped entirely when target is null
  // (the case in our test instances since redisHost is blank and readDataStore
  // is mocked to null).
  check: vi.fn().mockResolvedValue({ ok: false, error: 'mock' })
}))
vi.mock('../portProbe.js', () => ({
  // Default: port is free, so the preflight passes and launch proceeds.
  isPortInUse: vi.fn().mockResolvedValue(false)
}))
vi.mock('../serverConfigs.js', () => ({
  readDataStore: vi.fn().mockResolvedValue(null),
  listServerConfigs: vi.fn(),
  isHybrasylDataDir: vi.fn()
}))
vi.mock('fs', async (importActual) => {
  const actual = await importActual()
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn()
    }
  }
})

import { launch } from './serverTarget.js'
import { ensureWorktree, releaseWorktree } from '../worktreeManager.js'
import {
  writeBuildProps,
  removeBuildProps,
  claimBuildProps,
  _resetClaimsForTests
} from '../buildProps.js'
import { promises as fs } from 'fs'

const REPO_WITH_XML = {
  id: 'i1',
  name: 'QA',
  mode: 'repo',
  binaryPath: '',
  serverRepoPath: 'D:/repos/server',
  serverBranch: 'develop',
  xmlRepoPath: 'D:/repos/xml',
  xmlBranch: 'main',
  dataDir: 'D:/ceridwen',
  logDir: 'D:/hyb-logs',
  configFileName: 'config.xml',
  redisHost: '',
  redisPort: 6379,
  redisDatabase: null,
  redisPassword: '',
  lobbyPort: 2610,
  loginPort: 2611,
  worldPort: 2612
}

describe('launch (repo mode cleanup invariants)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetClaimsForTests()
  })

  it('releases the server worktree when the server csproj lacks UseLocalXml', async () => {
    ensureWorktree.mockResolvedValueOnce('D:/repos/server/.wt/develop')
    fs.readFile.mockResolvedValueOnce('<Project>no localxml block here</Project>')

    const result = await launch(REPO_WITH_XML)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/UseLocalXml/)
    expect(releaseWorktree).toHaveBeenCalledWith('D:/repos/server', 'develop')
    // Xml worktree never acquired, build-props never written.
    expect(releaseWorktree).toHaveBeenCalledTimes(1)
    expect(writeBuildProps).not.toHaveBeenCalled()
    expect(removeBuildProps).not.toHaveBeenCalled()
  })

  it('releases the server worktree when ensureWorktree(xml) throws', async () => {
    ensureWorktree
      .mockResolvedValueOnce('D:/repos/server/.wt/develop')
      .mockRejectedValueOnce(new Error('xml worktree add failed'))
    fs.readFile.mockResolvedValueOnce('<Project>UseLocalXml=true</Project>')

    const result = await launch(REPO_WITH_XML)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Failed to set up repo-mode launch/)
    // Server worktree must be released; xml never acquired so no release call
    // for it; build-props never written.
    expect(releaseWorktree).toHaveBeenCalledWith('D:/repos/server', 'develop')
    expect(releaseWorktree).toHaveBeenCalledTimes(1)
    expect(removeBuildProps).not.toHaveBeenCalled()
  })

  // HTOO-89. Both instances are on server branch `develop`, so they share one
  // worktree and one Directory.Build.props. The second launch used to rewrite
  // the first one's redirect, and the first instance kept running against a
  // build that now pointed at the other XML branch.
  it('refuses a launch that would overwrite a live redirect', async () => {
    ensureWorktree
      .mockResolvedValueOnce('D:/repos/server/.wt/develop')
      .mockResolvedValueOnce('D:/repos/xml/.wt/main')
    fs.readFile.mockResolvedValueOnce('<Project>UseLocalXml=true</Project>')
    claimBuildProps(
      'D:/repos/server/.wt/develop',
      'D:/repos/xml/.wt/experiment/src/Hybrasyl.Xml.csproj',
      'already-running',
      'experiment'
    )

    const result = await launch(REPO_WITH_XML)

    expect(result.success).toBe(false)
    // The message has to name both branches — the user's next move is to stop
    // one instance or align the two, and neither is obvious without them.
    expect(result.error).toMatch(/"experiment"/)
    expect(result.error).toMatch(/"main"/)
    // The redirect on disk still belongs to the running instance.
    expect(writeBuildProps).not.toHaveBeenCalled()
    expect(removeBuildProps).not.toHaveBeenCalled()
    // Both worktrees this launch acquired are handed back.
    expect(releaseWorktree).toHaveBeenCalledWith('D:/repos/server', 'develop')
    expect(releaseWorktree).toHaveBeenCalledWith('D:/repos/xml', 'main')
  })

  it('allows a second instance that wants the same XML branch', async () => {
    ensureWorktree
      .mockResolvedValueOnce('D:/repos/server/.wt/develop')
      .mockResolvedValueOnce('D:/repos/xml/.wt/main')
    fs.readFile.mockResolvedValueOnce('<Project>UseLocalXml=true</Project>')
    claimBuildProps(
      'D:/repos/server/.wt/develop',
      'D:/repos/xml/.wt/main/src/Hybrasyl.Xml.csproj',
      'already-running',
      'main'
    )

    // Fail the write so the launch stops before the spawn — this file has no
    // process mocks, and reaching spawnInPowerShellConsole would start real
    // PowerShell. What matters here is that the claim let us get that far.
    writeBuildProps.mockRejectedValueOnce(new Error('disk on fire'))

    const result = await launch(REPO_WITH_XML)

    // Sharing a redirect is the supported case, so the guard must not fire.
    expect(result.error).not.toMatch(/Another running instance/)
    expect(result.error).toMatch(/Failed to set up repo-mode launch/)
    expect(writeBuildProps).toHaveBeenCalledWith(
      'D:/repos/server/.wt/develop',
      expect.stringContaining('Hybrasyl.Xml.csproj')
    )
    expect(releaseWorktree).toHaveBeenCalledWith('D:/repos/server', 'develop')
    expect(releaseWorktree).toHaveBeenCalledWith('D:/repos/xml', 'main')
  })

  it('releases the claim when the launch fails after taking it', async () => {
    ensureWorktree
      .mockResolvedValueOnce('D:/repos/server/.wt/develop')
      .mockResolvedValueOnce('D:/repos/xml/.wt/main')
    fs.readFile.mockResolvedValueOnce('<Project>UseLocalXml=true</Project>')
    writeBuildProps.mockRejectedValueOnce(new Error('disk on fire'))

    expect((await launch(REPO_WITH_XML)).success).toBe(false)

    // A claim stranded by a failed launch would block every later launch on a
    // different XML branch until Epona restarted.
    expect(
      claimBuildProps(
        'D:/repos/server/.wt/develop',
        'D:/repos/xml/.wt/other/src/Hybrasyl.Xml.csproj',
        'someone-else',
        'other'
      )
    ).toEqual({ ok: true })
    // Nothing was written, so nothing should be removed either.
    expect(removeBuildProps).not.toHaveBeenCalled()
  })
})
