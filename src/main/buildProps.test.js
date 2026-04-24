import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { writeBuildProps, removeBuildProps } from './buildProps.js'

let workDir

beforeEach(async () => {
  workDir = await fs.mkdtemp(join(tmpdir(), 'epona-buildprops-'))
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
    expect(content).toContain('E:\\Dark Ages Dev\\Repos\\xml\\.worktrees\\develop\\src\\Hybrasyl.Xml.csproj')
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
