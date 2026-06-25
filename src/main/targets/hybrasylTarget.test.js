import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { resolvePath, buildSpawnArgs, launch } from './hybrasylTarget.js'

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

  it('classifies a .dll file as kind "dll" with cwd at its directory', async () => {
    const dllPath = join(dir, 'GameClient.dll')
    await fs.writeFile(dllPath, 'stub', 'utf-8')

    const result = await resolvePath(dllPath)
    expect(result.kind).toBe('dll')
    expect(result.dllPath).toBe(dllPath)
    expect(result.cwd).toBe(dir)
  })

  it.skipIf(process.platform === 'win32')(
    'classifies an extension-less executable as kind "exe" on non-Windows (apphost)',
    async () => {
      const appHost = join(dir, 'GameClient')
      await fs.writeFile(appHost, 'stub', 'utf-8')
      await fs.chmod(appHost, 0o755)

      const result = await resolvePath(appHost)
      expect(result.kind).toBe('exe')
      expect(result.exePath).toBe(appHost)
      expect(result.cwd).toBe(dir)
    }
  )

  it.skipIf(process.platform === 'win32')(
    'returns invalid for a non-executable extension-less file on non-Windows',
    async () => {
      const plain = join(dir, 'README')
      await fs.writeFile(plain, 'stub', 'utf-8')
      await fs.chmod(plain, 0o644)

      const result = await resolvePath(plain)
      expect(result.kind).toBe('invalid')
    }
  )

  it('returns invalid for unsupported, non-executable extensions', async () => {
    const slnPath = join(dir, 'client.sln')
    await fs.writeFile(slnPath, 'stub', 'utf-8')
    await fs.chmod(slnPath, 0o644)

    const result = await resolvePath(slnPath)
    expect(result.kind).toBe('invalid')
    expect(result.reason).toMatch(/\.dll.*\.csproj/)
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

  it('returns `dotnet <dll>` for dll kind', () => {
    const args = buildSpawnArgs({
      kind: 'dll',
      dllPath: '/opt/client/GameClient.dll',
      cwd: '/opt/client'
    })
    expect(args).toEqual({
      command: 'dotnet',
      args: ['/opt/client/GameClient.dll'],
      cwd: '/opt/client'
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

// Pre-spawn validation paths in launch(). All four return a friendly error
// before any child_process is created, so we can exercise the contract
// without mocking spawn.
describe('launch (pre-spawn validation)', () => {
  it('errors when daClientPath is empty', async () => {
    const result = await launch({ mode: 'binary', binaryPath: '' }, null, '')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(
      process.platform === 'win32'
        ? /Dark Ages client path not set/
        : /Dark Ages assets path not set/
    )
  })

  it('errors on an unknown mode', async () => {
    const result = await launch({ mode: 'whatever' }, null, 'C:/Dark Ages/Darkages.exe')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Unknown mode/)
  })

  it('errors when binary mode is given a .csproj path', async () => {
    const projDir = join(dir, 'proj')
    await fs.mkdir(projDir)
    const csprojPath = join(projDir, 'client.csproj')
    await fs.writeFile(csprojPath, '<Project />', 'utf-8')

    const result = await launch(
      { mode: 'binary', binaryPath: csprojPath },
      null,
      join(dir, 'Darkages.exe')
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Binary mode requires an executable or \.dll/)
  })

  it('errors when repo mode is given a .exe path', async () => {
    const exePath = join(dir, 'client.exe')
    await fs.writeFile(exePath, 'stub', 'utf-8')

    const result = await launch(
      { mode: 'repo', clientRepoPath: exePath, clientBranch: null },
      null,
      join(dir, 'Darkages.exe')
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Repo mode requires a \.csproj path/)
  })
})
