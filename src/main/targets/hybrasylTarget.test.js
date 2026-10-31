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

  it.runIf(process.platform === 'win32')(
    'classifies a .exe file as kind "exe" and sets cwd to its directory',
    async () => {
      const exePath = join(dir, 'client.exe')
      await fs.writeFile(exePath, 'stub', 'utf-8')

      const result = await resolvePath(exePath)
      expect(result.kind).toBe('exe')
      expect(result.exePath).toBe(exePath)
      expect(result.cwd).toBe(dir)
    }
  )

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

  it.runIf(process.platform === 'win32')('matches .exe / .csproj case-insensitively', async () => {
    const exePath = join(dir, 'CLIENT.EXE')
    await fs.writeFile(exePath, 'stub', 'utf-8')

    const result = await resolvePath(exePath)
    expect(result.kind).toBe('exe')
  })

  it.skipIf(process.platform === 'win32')(
    'refuses a .exe off Windows, which cannot run there (F12)',
    async () => {
      const exePath = join(dir, 'CLIENT.EXE')
      await fs.writeFile(exePath, 'stub', 'utf-8')

      const result = await resolvePath(exePath)
      expect(result).toEqual({
        kind: 'invalid',
        reason: expect.stringMatching(/^this is a Windows program/)
      })
    }
  )

  it.skipIf(process.platform === 'win32')(
    'names chmod +x for a client with no execute bit (HTOO-594)',
    async () => {
      const plain = join(dir, 'Brigid')
      await fs.writeFile(plain, 'stub', 'utf-8')
      await fs.chmod(plain, 0o644)

      expect((await resolvePath(plain)).reason).toMatch(/chmod \+x/)
    }
  )
})

// A macOS app bundle (HTOO-593). Brigid ships for macOS only as Brigid.app.
// The check reads the program's execute bit, which Windows does not have, so
// this runs on the ubuntu and macos legs of unit-posix.
describe.skipIf(process.platform === 'win32')('resolvePath for a .app bundle on macOS', () => {
  const realPlatform = process.platform
  beforeEach(() => Object.defineProperty(process, 'platform', { value: 'darwin' }))
  afterEach(() => Object.defineProperty(process, 'platform', { value: realPlatform }))

  async function bundle(name, { plist, program, mode = 0o755 } = {}) {
    const root = join(dir, `${name}.app`)
    await fs.mkdir(join(root, 'Contents', 'MacOS'), { recursive: true })
    if (plist !== undefined) await fs.writeFile(join(root, 'Contents', 'Info.plist'), plist)
    if (program) {
      const exe = join(root, 'Contents', 'MacOS', program)
      await fs.writeFile(exe, 'stub')
      await fs.chmod(exe, mode)
    }
    return root
  }

  const plistFor = (exe) =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n    <key>CFBundleExecutable</key>\n    <string>${exe}</string>\n</dict>\n</plist>\n`

  it('runs Contents/MacOS/<CFBundleExecutable>', async () => {
    const root = await bundle('Brigid', {
      plist: plistFor('BrigidClient'),
      program: 'BrigidClient'
    })

    const result = await resolvePath(`${root}/`)

    const exePath = join(root, 'Contents', 'MacOS', 'BrigidClient')
    expect(result).toEqual({ kind: 'exe', exePath, cwd: join(root, 'Contents', 'MacOS') })
  })

  it("falls back to the bundle's base name with no Info.plist", async () => {
    const root = await bundle('Brigid', { program: 'Brigid' })
    expect((await resolvePath(root)).exePath).toBe(join(root, 'Contents', 'MacOS', 'Brigid'))
  })

  it('names the missing program', async () => {
    const root = await bundle('Brigid', { plist: plistFor('Brigid') })
    expect(await resolvePath(root)).toEqual({
      kind: 'invalid',
      reason: 'the app bundle has no program at Contents/MacOS/Brigid'
    })
  })

  it('is a folder like any other off macOS', async () => {
    const root = await bundle('Brigid', { program: 'Brigid' })
    Object.defineProperty(process, 'platform', { value: 'linux' })
    expect((await resolvePath(root)).reason).toMatch(/not a file/)
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
    // Both messages name where to go and fix it, and the destination differs by
    // platform: Windows picks an exe from the toolbar, everywhere else picks a
    // folder in the Legacy Client tab (HTOO-296).
    expect(result.error).toMatch(
      process.platform === 'win32' ? /Dark Ages client path not set/ : /Dark Ages folder not set/
    )
    expect(result.error).toMatch(
      process.platform === 'win32' ? /Locate Client button/ : /Legacy Client tab/
    )
  })

  it('errors on an unknown mode', async () => {
    const result = await launch({ mode: 'whatever' }, null, dir)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Unknown mode/)
  })

  it('errors when binary mode is given a .csproj path', async () => {
    const projDir = join(dir, 'proj')
    await fs.mkdir(projDir)
    const csprojPath = join(projDir, 'client.csproj')
    await fs.writeFile(csprojPath, '<Project />', 'utf-8')

    const result = await launch({ mode: 'binary', binaryPath: csprojPath }, null, dir)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Binary mode requires an executable or \.dll/)
  })

  it('errors when repo mode is given a .dll path', async () => {
    const dllPath = join(dir, 'client.dll')
    await fs.writeFile(dllPath, 'stub', 'utf-8')

    const result = await launch(
      { mode: 'repo', clientRepoPath: dllPath, clientBranch: null },
      null,
      dir
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Repo mode requires a \.csproj path/)
  })
})
