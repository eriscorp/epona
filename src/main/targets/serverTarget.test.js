import { describe, it, expect } from 'vitest'
import {
  resolveConfigFile,
  stripXmlExt,
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

describe('resolveConfigFile', () => {
  it('defaults the filename to config.xml when none is given', () => {
    expect(resolveConfigFile('D:/ceridwen')).toBe(
      join('D:/ceridwen', 'xml', 'serverconfigs', 'config.xml')
    )
  })

  it('uses the supplied config filename', () => {
    expect(resolveConfigFile('D:/ceridwen', 'qa.xml')).toBe(
      join('D:/ceridwen', 'xml', 'serverconfigs', 'qa.xml')
    )
  })
})

describe('stripXmlExt', () => {
  it('strips a lower-case .xml suffix', () => {
    expect(stripXmlExt('local.xml')).toBe('local')
  })
  it('strips regardless of case', () => {
    expect(stripXmlExt('QA.XML')).toBe('QA')
    expect(stripXmlExt('dev.Xml')).toBe('dev')
  })
  it('returns an input with no .xml suffix untouched', () => {
    expect(stripXmlExt('local')).toBe('local')
  })
  it('returns empty string for non-string input', () => {
    expect(stripXmlExt(null)).toBe('')
    expect(stripXmlExt(undefined)).toBe('')
  })
})

describe('buildBinarySpawn', () => {
  it('wraps a .dll target with `dotnet <dll>` and uses the server\'s lowercase flags', () => {
    const spec = buildBinarySpawn(BASE_INSTANCE)
    expect(spec.command).toBe('dotnet')
    expect(spec.args[0]).toBe('D:/hyb/Hybrasyl.dll')
    // Flag order is deterministic — assert exact sequence so a flag rename
    // breaks loudly rather than silently.
    expect(spec.args.slice(1)).toEqual([
      '--dataDir', 'D:/ceridwen',
      '--worldDataDir', join('D:/ceridwen', 'xml'),
      '--logDir', 'D:/hyb-logs',
      '--config', 'config'
    ])
  })

  it('invokes a .exe target directly (no dotnet wrapper)', () => {
    const spec = buildBinarySpawn({ ...BASE_INSTANCE, binaryPath: 'D:/hyb/Hybrasyl.exe' })
    expect(spec.command).toBe('D:/hyb/Hybrasyl.exe')
    expect(spec.args).toEqual([
      '--dataDir', 'D:/ceridwen',
      '--worldDataDir', join('D:/ceridwen', 'xml'),
      '--logDir', 'D:/hyb-logs',
      '--config', 'config'
    ])
  })

  it('matches .exe case-insensitively', () => {
    const spec = buildBinarySpawn({ ...BASE_INSTANCE, binaryPath: 'D:/HYB.EXE' })
    expect(spec.command).toBe('D:/HYB.EXE')
  })

  it('strips .xml from configFileName for --config', () => {
    const spec = buildBinarySpawn({ ...BASE_INSTANCE, configFileName: 'local.xml' })
    expect(spec.args).toContain('local')
    expect(spec.args).not.toContain('local.xml')
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
      '--project', join('D:/repos/server/.worktrees/develop', 'hybrasyl', 'Hybrasyl.csproj'),
      '--configuration', 'Debug',
      '--no-launch-profile',
      '--',
      '--dataDir', 'D:/ceridwen',
      '--worldDataDir', join('D:/ceridwen', 'xml'),
      '--logDir', 'D:/hyb-logs',
      '--config', 'config'
    ])
  })

  it('strips .xml from configFileName for --config', () => {
    const spec = buildRepoSpawn(
      { ...REPO_INSTANCE, configFileName: 'qa.xml' },
      'D:/wt'
    )
    expect(spec.args).toContain('qa')
    expect(spec.args).not.toContain('qa.xml')
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
    expect(validateForLaunch({
      ...REPO_INSTANCE,
      xmlRepoPath: 'D:/repos/xml',
      xmlBranch: 'develop'
    })).toEqual({ ok: true })
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
