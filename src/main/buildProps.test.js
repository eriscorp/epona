import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  writeBuildProps,
  removeBuildProps,
  claimBuildProps,
  releaseBuildProps,
  _resetClaimsForTests
} from './buildProps.js'

let workDir

beforeEach(async () => {
  workDir = await fs.mkdtemp(join(tmpdir(), 'epona-buildprops-'))
  _resetClaimsForTests()
})

afterEach(async () => {
  if (workDir) await fs.rm(workDir, { recursive: true, force: true })
})

describe('writeBuildProps', () => {
  it('writes a Directory.Build.props with the expected XML', async () => {
    const xmlCsproj = 'E:\\Dark Ages Dev\\Repos\\xml\\.worktrees\\develop\\src\\Hybrasyl.Xml.csproj'
    const result = await writeBuildProps(workDir, xmlCsproj)
    expect(result.written).toBe(true)
    const content = await fs.readFile(join(workDir, 'Directory.Build.props'), 'utf-8')
    expect(content).toContain('<UseLocalXml>true</UseLocalXml>')
    expect(content).toContain(`<LocalXmlProjectPath>${xmlCsproj}</LocalXmlProjectPath>`)
    expect(content).toMatch(/^<Project>/)
  })

  it('converts forward-slash paths to backslashes', async () => {
    const result = await writeBuildProps(
      workDir,
      'E:/Dark Ages Dev/Repos/xml/.worktrees/develop/src/Hybrasyl.Xml.csproj'
    )
    expect(result.written).toBe(true)
    const content = await fs.readFile(join(workDir, 'Directory.Build.props'), 'utf-8')
    // MSBuild prefers backslashes; the design doc shows them.
    expect(content).toContain(
      'E:\\Dark Ages Dev\\Repos\\xml\\.worktrees\\develop\\src\\Hybrasyl.Xml.csproj'
    )
    expect(content).not.toContain('E:/Dark Ages Dev/Repos/xml')
  })

  it('is idempotent — second write with the same content reports written: false', async () => {
    const xmlCsproj = 'D:/x.csproj'
    await writeBuildProps(workDir, xmlCsproj)
    const stat1 = await fs.stat(join(workDir, 'Directory.Build.props'))
    // Wait one ms tick so any rewrite would visibly change mtime
    await new Promise((r) => setTimeout(r, 10))
    const result = await writeBuildProps(workDir, xmlCsproj)
    expect(result.written).toBe(false)
    const stat2 = await fs.stat(join(workDir, 'Directory.Build.props'))
    expect(stat2.mtimeMs).toBe(stat1.mtimeMs)
  })

  it('rewrites when content changes (different XML path)', async () => {
    await writeBuildProps(workDir, 'D:/old.csproj')
    const result = await writeBuildProps(workDir, 'D:/new.csproj')
    expect(result.written).toBe(true)
    const content = await fs.readFile(join(workDir, 'Directory.Build.props'), 'utf-8')
    expect(content).toContain('D:\\new.csproj')
    expect(content).not.toContain('D:\\old.csproj')
  })

  it('throws when serverWorktreePath is missing', async () => {
    await expect(writeBuildProps('', 'D:/x.csproj')).rejects.toThrow(/serverWorktreePath/)
  })

  it('throws when xmlCsprojAbsPath is missing', async () => {
    await expect(writeBuildProps(workDir, '')).rejects.toThrow(/xmlCsprojAbsPath/)
  })
})

describe('removeBuildProps', () => {
  it('removes an existing file', async () => {
    await writeBuildProps(workDir, 'D:/x.csproj')
    const result = await removeBuildProps(workDir)
    expect(result.removed).toBe(true)
    await expect(fs.stat(join(workDir, 'Directory.Build.props'))).rejects.toThrow()
  })

  it('is idempotent — removing a missing file reports removed: false', async () => {
    const result = await removeBuildProps(workDir)
    expect(result.removed).toBe(false)
  })

  it('throws when serverWorktreePath is missing', async () => {
    await expect(removeBuildProps('')).rejects.toThrow(/serverWorktreePath/)
  })
})

// HTOO-89. Two instances on one server branch share a worktree, and the
// redirect is keyed by that worktree alone.
describe('claimBuildProps / releaseBuildProps', () => {
  const WT = 'E:\\repos\\server\\.worktrees\\develop'
  const XML_A = 'E:\\repos\\xml\\.worktrees\\feature-a\\src\\Hybrasyl.Xml.csproj'
  const XML_B = 'E:\\repos\\xml\\.worktrees\\feature-b\\src\\Hybrasyl.Xml.csproj'

  it('lets the first claimant through', () => {
    expect(claimBuildProps(WT, XML_A, 'inst-1', 'feature-a')).toEqual({ ok: true })
  })

  it('refuses a second owner that wants a different XML target', () => {
    claimBuildProps(WT, XML_A, 'inst-1', 'feature-a')
    const result = claimBuildProps(WT, XML_B, 'inst-2', 'feature-b')
    expect(result.ok).toBe(false)
    expect(result.conflict).toMatchObject({ ownerId: 'inst-1', xmlBranchLabel: 'feature-a' })
  })

  it('allows a second owner that wants the same XML target', () => {
    claimBuildProps(WT, XML_A, 'inst-1', 'feature-a')
    expect(claimBuildProps(WT, XML_A, 'inst-2', 'feature-a')).toEqual({ ok: true })
  })

  it('compares the target by path, not by branch label', () => {
    // Same csproj reached with the other separator: still the same file, so
    // this must not read as a conflict.
    claimBuildProps(WT, XML_A, 'inst-1', 'feature-a')
    expect(claimBuildProps(WT, XML_A.replace(/\\/g, '/'), 'inst-2', 'whatever')).toEqual({
      ok: true
    })
  })

  it('does not conflict with itself when the same owner relaunches', () => {
    claimBuildProps(WT, XML_A, 'inst-1', 'feature-a')
    expect(claimBuildProps(WT, XML_B, 'inst-1', 'feature-b')).toEqual({ ok: true })
  })

  it('keys claims by worktree, so a different server branch is unaffected', () => {
    claimBuildProps(WT, XML_A, 'inst-1', 'feature-a')
    const other = 'E:\\repos\\server\\.worktrees\\main'
    expect(claimBuildProps(other, XML_B, 'inst-2', 'feature-b')).toEqual({ ok: true })
  })

  it('reports the last release so only it removes the file', () => {
    claimBuildProps(WT, XML_A, 'inst-1', 'feature-a')
    claimBuildProps(WT, XML_A, 'inst-2', 'feature-a')
    expect(releaseBuildProps(WT, 'inst-1')).toEqual({ last: false })
    expect(releaseBuildProps(WT, 'inst-2')).toEqual({ last: true })
  })

  it('frees the worktree once released, so the next launch can differ', () => {
    claimBuildProps(WT, XML_A, 'inst-1', 'feature-a')
    releaseBuildProps(WT, 'inst-1')
    expect(claimBuildProps(WT, XML_B, 'inst-2', 'feature-b')).toEqual({ ok: true })
  })

  it('treats an unknown release as the last one', () => {
    // A crash-left file has no claimant. Reporting `last` lets teardown clean
    // it up rather than leaving it to wedge the next launch.
    expect(releaseBuildProps(WT, 'never-claimed')).toEqual({ last: true })
  })
})
