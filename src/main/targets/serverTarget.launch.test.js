import { describe, it, expect, vi, beforeEach } from 'vitest'

// Module-level mocks must be declared before the imports that consume them.
// These tests exercise launch()'s cleanup ladder for repo-mode failures —
// the pure-function tests in serverTarget.test.js cover the rest.
vi.mock('../worktreeManager.js', () => ({
  ensureWorktree: vi.fn(),
  releaseWorktree: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('../buildProps.js', () => ({
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
import { writeBuildProps, removeBuildProps } from '../buildProps.js'
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
})
