import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { resolvePath, buildSpawnArgs } from './hybrasylLauncher.js'

let dir

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'epona-hybrasyl-launcher-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('resolvePath', () => {
  it('returns invalid when no path is configured', async () => {
    const result = await resolvePath('')
    expect(result.kind).toBe('invalid')
    expect(result.reason).toMatch(/no path/i)
  })

  it('returns invalid when the path does not exist', async () => {
    const result = await resolvePath(join(dir, 'does-not-exist.exe'))
    expect(result.kind).toBe('invalid')
    expect(result.reason).toMatch(/does not exist/i)
  })

  it('returns invalid when the path is a directory', async () => {
    const result = await resolvePath(dir)
    expect(result.kind).toBe('invalid')
    expect(result.reason).toMatch(/not a file/i)
  })

  it('classifies a .exe file as kind "exe" and sets cwd to its directory', async () => {
    const exePath = join(dir, 'client.exe')
    await fs.writeFile(exePath, 'stub', 'utf-8')

    const result = await resolvePath(exePath)
    expect(result.kind).toBe('exe')
    expect(result.exePath).toBe(exePath)
    expect(result.cwd).toBe(dir)
  })

  it('classifies a .csproj file as kind "repo" with cwd at the csproj directory', async () => {
    const projDir = join(dir, 'client-project')
    await fs.mkdir(projDir)
    const csprojPath = join(projDir, 'client.csproj')
    await fs.writeFile(csprojPath, '<Project />', 'utf-8')

    const result = await resolvePath(csprojPath)
    expect(result.kind).toBe('repo')
    expect(result.csprojPath).toBe(csprojPath)
    expect(result.cwd).toBe(projDir)
  })

  it('returns invalid for unsupported extensions', async () => {
    const slnPath = join(dir, 'client.sln')
    await fs.writeFile(slnPath, 'stub', 'utf-8')

    const result = await resolvePath(slnPath)
    expect(result.kind).toBe('invalid')
    expect(result.reason).toMatch(/\.exe or \.csproj/)
  })

  it('matches .exe / .csproj case-insensitively', async () => {
    const exePath = join(dir, 'CLIENT.EXE')
    await fs.writeFile(exePath, 'stub', 'utf-8')

    const result = await resolvePath(exePath)
    expect(result.kind).toBe('exe')
  })
})

describe('buildSpawnArgs', () => {
  it('returns the exe path as the command with no args for exe kind', () => {
    const args = buildSpawnArgs({ kind: 'exe', exePath: 'C:/client/client.exe', cwd: 'C:/client' })
    expect(args).toEqual({
      command: 'C:/client/client.exe',
      args: [],
      cwd: 'C:/client'
    })
  })

  it('returns dotnet run with the csproj path for repo kind', () => {
    const args = buildSpawnArgs({
      kind: 'repo',
      csprojPath: 'D:/client-repo/client-project/client.csproj',
      cwd: 'D:/client-repo/client-project'
    })
    expect(args).toEqual({
      command: 'dotnet',
      args: [
        'run',
        '--project',
        'D:/client-repo/client-project/client.csproj',
        '--configuration',
        'Debug'
      ],
      cwd: 'D:/client-repo/client-project'
    })
  })

  it('throws when given an invalid kind', () => {
    expect(() => buildSpawnArgs({ kind: 'invalid' })).toThrow(/invalid/)
  })
})
