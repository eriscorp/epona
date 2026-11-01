import { describe, it, expect } from 'vitest'
import {
  serverConfigPath,
  leftoverServerHint,
  buildConsoleScript,
  consoleLogPath,
  buildBinarySpawn,
  buildRepoSpawn,
  validateForLaunch
} from './serverTarget.js'
import { join } from 'path'

const BASE_INSTANCE = {
  id: 'i1',
  name: 'QA',
  mode: 'binary',
  binaryPath: 'D:/hyb/Hybrasyl.dll',
  serverRepoPath: '',
  serverBranch: null,
  xmlRepoPath: '',
  xmlBranch: null,
  dataDir: 'D:/ceridwen',
  logDir: 'D:/hyb-logs',
  configFileName: 'config.xml',
  // redisHost blank = "don't override, use XML DataStore". The override tests
  // below populate it to exercise the env-var path.
  redisHost: '',
  redisPort: 6379,
  redisDatabase: null,
  redisPassword: '',
  lobbyPort: 2610,
  loginPort: 2611,
  worldPort: 2612
}

const REPO_INSTANCE = {
  ...BASE_INSTANCE,
  mode: 'repo',
  binaryPath: '',
  serverRepoPath: 'D:/repos/server',
  serverBranch: 'develop',
  xmlRepoPath: '',
  xmlBranch: null
}

describe('serverConfigPath', () => {
  it('is the picked file under <dataDir>/xml/serverconfigs, with its own spelling', () => {
    // The file name, not the Name attribute, and with its case (HTOO-595).
    expect(serverConfigPath({ dataDir: 'D:/world', configFileName: 'Local.XML' })).toBe(
      join('D:/world', 'xml', 'serverconfigs', 'Local.XML')
    )
  })
})

describe('buildBinarySpawn', () => {
  it("wraps a .dll target with `dotnet <dll>` and uses the server's lowercase flags", () => {
    const spec = buildBinarySpawn(BASE_INSTANCE)
    expect(spec.command).toBe('dotnet')
    expect(spec.args[0]).toBe('D:/hyb/Hybrasyl.dll')
    // Flag order is deterministic — assert exact sequence so a flag rename
    // breaks loudly rather than silently.
    expect(spec.args.slice(1)).toEqual([
      '--dataDir',
      'D:/ceridwen',
      '--worldDataDir',
      join('D:/ceridwen', 'xml'),
      '--logDir',
      'D:/hyb-logs',
      '--configFile',
      join('D:/ceridwen', 'xml', 'serverconfigs', 'config.xml')
    ])
  })

  it('invokes a .exe target directly (no dotnet wrapper)', () => {
    const spec = buildBinarySpawn({ ...BASE_INSTANCE, binaryPath: 'D:/hyb/Hybrasyl.exe' })
    expect(spec.command).toBe('D:/hyb/Hybrasyl.exe')
    expect(spec.args).toEqual([
      '--dataDir',
      'D:/ceridwen',
      '--worldDataDir',
      join('D:/ceridwen', 'xml'),
      '--logDir',
      'D:/hyb-logs',
      '--configFile',
      join('D:/ceridwen', 'xml', 'serverconfigs', 'config.xml')
    ])
  })

  it('runs a macOS or Linux apphost directly, not through dotnet (F10)', () => {
    const spec = buildBinarySpawn({ ...BASE_INSTANCE, binaryPath: '/opt/hybrasyl/Hybrasyl' })
    expect(spec.command).toBe('/opt/hybrasyl/Hybrasyl')
    expect(spec.args[0]).toBe('--dataDir')
  })

  it('matches .exe case-insensitively', () => {
    const spec = buildBinarySpawn({ ...BASE_INSTANCE, binaryPath: 'D:/HYB.EXE' })
    expect(spec.command).toBe('D:/HYB.EXE')
  })

  it('passes the config file to --configFile, not a name to --config (HTOO-595)', () => {
    // config.xml has no Name attribute, so its name is "default"; `--config
    // config` stopped the server with "no configurations with that name".
    const spec = buildBinarySpawn({ ...BASE_INSTANCE, configFileName: 'config.xml' })
    expect(spec.args).not.toContain('--config')
    expect(spec.args).toContain(join('D:/ceridwen', 'xml', 'serverconfigs', 'config.xml'))
  })

  it('emits no HYB_REDIS_* env vars when redisHost is blank (server reads XML)', () => {
    const spec = buildBinarySpawn(BASE_INSTANCE)
    expect(spec.env).toEqual({})
  })

  it('emits HYB_REDIS_HOST and HYB_REDIS_PORT when redisHost is populated', () => {
    const spec = buildBinarySpawn({ ...BASE_INSTANCE, redisHost: '10.0.0.5', redisPort: 7000 })
    expect(spec.env.HYB_REDIS_HOST).toBe('10.0.0.5')
    expect(spec.env.HYB_REDIS_PORT).toBe('7000')
    // Not set when not supplied:
    expect(spec.env).not.toHaveProperty('HYB_REDIS_DB')
    expect(spec.env).not.toHaveProperty('HYB_REDIS_PASSWORD')
  })

  it('emits HYB_REDIS_DB when redisDatabase is set', () => {
    const spec = buildBinarySpawn({ ...BASE_INSTANCE, redisHost: 'h', redisDatabase: 3 })
    expect(spec.env.HYB_REDIS_DB).toBe('3')
  })

  it('emits HYB_REDIS_PASSWORD when redisPassword is non-empty', () => {
    const spec = buildBinarySpawn({ ...BASE_INSTANCE, redisHost: 'h', redisPassword: 'secret' })
    expect(spec.env.HYB_REDIS_PASSWORD).toBe('secret')
  })
})

describe('buildRepoSpawn', () => {
  it('returns dotnet run --project <serverWorktree>/hybrasyl/Hybrasyl.csproj plus server flags', () => {
    const spec = buildRepoSpawn(REPO_INSTANCE, 'D:/repos/server/.worktrees/develop')
    expect(spec.command).toBe('dotnet')
    expect(spec.args).toEqual([
      'run',
      '--project',
      join('D:/repos/server/.worktrees/develop', 'hybrasyl', 'Hybrasyl.csproj'),
      '--configuration',
      'Debug',
      '--no-launch-profile',
      '--',
      '--dataDir',
      'D:/ceridwen',
      '--worldDataDir',
      join('D:/ceridwen', 'xml'),
      '--logDir',
      'D:/hyb-logs',
      '--configFile',
      join('D:/ceridwen', 'xml', 'serverconfigs', 'config.xml')
    ])
  })

  it('passes the config file to --configFile, as binary mode does (HTOO-595)', () => {
    const spec = buildRepoSpawn({ ...REPO_INSTANCE, configFileName: 'local.xml' }, 'D:/wt')
    const at = spec.args.indexOf('--configFile')
    expect(spec.args[at + 1]).toBe(join('D:/ceridwen', 'xml', 'serverconfigs', 'local.xml'))
  })

  it('emits HYB_REDIS_* env vars when redisHost is populated, same as binary mode', () => {
    const spec = buildRepoSpawn(
      { ...REPO_INSTANCE, redisHost: '10.0.0.5', redisPort: 7000 },
      'D:/wt'
    )
    expect(spec.env.HYB_REDIS_HOST).toBe('10.0.0.5')
    expect(spec.env.HYB_REDIS_PORT).toBe('7000')
  })

  it('emits no HYB_REDIS_* env vars when redisHost is blank', () => {
    const spec = buildRepoSpawn(REPO_INSTANCE, 'D:/wt')
    expect(spec.env).toEqual({})
  })
})

describe('validateForLaunch', () => {
  it('accepts a fully-populated binary-mode instance', () => {
    expect(validateForLaunch(BASE_INSTANCE)).toEqual({ ok: true })
  })

  it('accepts a repo-mode instance with serverRepoPath + serverBranch', () => {
    expect(validateForLaunch(REPO_INSTANCE)).toEqual({ ok: true })
  })

  it('accepts a repo-mode instance with serverBranch null (use current checkout)', () => {
    expect(validateForLaunch({ ...REPO_INSTANCE, serverBranch: null })).toEqual({ ok: true })
  })

  it('accepts a repo-mode instance with both server and xml branches', () => {
    expect(
      validateForLaunch({
        ...REPO_INSTANCE,
        xmlRepoPath: 'D:/repos/xml',
        xmlBranch: 'develop'
      })
    ).toEqual({ ok: true })
  })

  it('rejects when mode is unknown', () => {
    const result = validateForLaunch({ ...BASE_INSTANCE, mode: 'docker' })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Unknown mode/)
  })

  it('rejects when binaryPath is empty in binary mode', () => {
    const result = validateForLaunch({ ...BASE_INSTANCE, binaryPath: '' })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/binaryPath/)
  })

  it('rejects when serverRepoPath is empty in repo mode', () => {
    const result = validateForLaunch({ ...REPO_INSTANCE, serverRepoPath: '' })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/serverRepoPath/)
  })

  it('rejects when xmlBranch is set but xmlRepoPath is empty', () => {
    const result = validateForLaunch({
      ...REPO_INSTANCE,
      xmlBranch: 'develop',
      xmlRepoPath: ''
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/xmlRepoPath/)
  })

  it('rejects when dataDir is empty', () => {
    const result = validateForLaunch({ ...BASE_INSTANCE, dataDir: '' })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/dataDir/)
  })

  it('rejects when logDir is empty', () => {
    const result = validateForLaunch({ ...BASE_INSTANCE, logDir: '' })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/logDir/)
  })

  it('rejects when configFileName is empty', () => {
    const result = validateForLaunch({ ...BASE_INSTANCE, configFileName: '' })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/configFileName/)
  })
})

describe('leftoverServerHint (HTOO-596)', () => {
  it("names each OS's own tool", () => {
    expect(leftoverServerHint('win32')).toMatch(/dotnet\.exe in Task Manager/)
    expect(leftoverServerHint('darwin')).toMatch(/Activity Monitor/)
    expect(leftoverServerHint('linux')).toMatch(/`kill`/)
  })
})

describe('validateForLaunch for a .exe off Windows (HTOO-596)', () => {
  it.skipIf(process.platform === 'win32')('refuses a Windows program', () => {
    const result = validateForLaunch({ ...BASE_INSTANCE, binaryPath: '/x/Hybrasyl.exe' })
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/Windows program/) })
  })

  it.runIf(process.platform === 'win32')('accepts it on Windows', () => {
    expect(validateForLaunch({ ...BASE_INSTANCE, binaryPath: 'D:/hyb/Hybrasyl.exe' })).toEqual({
      ok: true
    })
  })
})

// HTOO-652. The console window on Windows keeps the server's output, and the
// script copies each line to a file that Epona follows into the Log Pane.
describe('the Windows console script', () => {
  const script = buildConsoleScript({
    command: 'C:/Program Files/dotnet/dotnet.exe',
    args: ['run', '--project', "D:/it's/Hybrasyl.csproj"],
    logFile: 'D:/logs/epona-console-i1.log'
  })

  it('pipes stdout and stderr, and leaves stdin to the console', () => {
    expect(script).toContain(
      "& 'C:/Program Files/dotnet/dotnet.exe' 'run' '--project' 'D:/it''s/Hybrasyl.csproj' 2>&1 | ForEach-Object"
    )
    expect(script).not.toMatch(/<|\$input/)
  })

  it('writes each line to the window and to the file as UTF-8 with no BOM', () => {
    // Tee-Object in Windows PowerShell 5.1 writes UTF-16.
    expect(script).not.toContain('Tee-Object')
    expect(script).toContain(
      "New-Object System.IO.StreamWriter('D:/logs/epona-console-i1.log', $false, (New-Object System.Text.UTF8Encoding $false))"
    )
    expect(script).toContain('[Console]::WriteLine($line); $log.WriteLine($line)')
    expect(script).toContain('[Console]::OutputEncoding = [System.Text.Encoding]::UTF8')
  })

  it('writes the end of the run in a finally, so a Ctrl+C in the window still ends the pane', () => {
    // PowerShell runs a finally block when Ctrl+C stops the script.
    expect(script).toMatch(/try \{ & .* \} finally \{ .*\$log\.Close\(\) \}/)
    expect(script).toContain(
      "$log.WriteLine('[epona] The server was stopped from its console window.')"
    )
  })

  it('writes the exit code to the file, and still waits for Enter in the window', () => {
    expect(script).toContain("$log.WriteLine('[epona] The server exited with code ' + $code + '.')")
    expect(script.trimEnd()).toMatch(/\$null = Read-Host$/)
  })

  it('keeps one file per instance in its log folder', () => {
    expect(consoleLogPath({ logDir: 'D:/logs', id: 'inst/1 x' })).toBe(
      join('D:/logs', 'epona-console-inst_1_x.log')
    )
  })
})
