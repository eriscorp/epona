import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createSettingsManager } from './settingsManager.js'

let dir

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'epona-settings-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('load', () => {
  it('returns defaults when no settings file exists', async () => {
    const mgr = createSettingsManager(dir)
    const settings = await mgr.load()

    expect(settings.clientPath).toBe('')
    expect(settings.version).toBe('auto')
    expect(settings.skipIntro).toBe(true)
    expect(settings.multipleInstances).toBe(true)
    expect(settings.hideWalls).toBe(false)
    expect(settings.theme).toBe('hybrasyl')
    expect(settings.activeProfile).toBe('official')
    expect(settings.profiles).toHaveLength(1)
    expect(settings.profiles[0].id).toBe('official')
  })

  it('returns defaults when settings file is corrupt JSON', async () => {
    await fs.writeFile(join(dir, 'settings.json'), '{not valid json', 'utf-8')
    const mgr = createSettingsManager(dir)
    const settings = await mgr.load()
    expect(settings.activeProfile).toBe('official')
  })

  it('recovers from backup when primary is corrupt', async () => {
    const validBackup = {
      clientPath: 'C:/recovered.exe',
      theme: 'chadul',
      profiles: [
        {
          id: 'official',
          name: 'Dark Ages (Official)',
          hostname: 'da0.kru.com',
          port: 2610,
          redirect: false
        }
      ],
      activeProfile: 'official'
    }
    await fs.writeFile(join(dir, 'settings.json'), '{corrupt', 'utf-8')
    await fs.writeFile(join(dir, 'settings.bak.json'), JSON.stringify(validBackup), 'utf-8')

    const mgr = createSettingsManager(dir)
    const settings = await mgr.load()

    expect(settings.clientPath).toBe('C:/recovered.exe')
    expect(settings.theme).toBe('chadul')
  })
})

describe('save/load round-trip', () => {
  it('persists changes across manager instances', async () => {
    const mgr1 = createSettingsManager(dir)
    const original = await mgr1.load()
    await mgr1.save({
      ...original,
      clientPath: 'C:/Dark Ages/Darkages.exe',
      theme: 'danaan',
      hideWalls: true
    })

    const mgr2 = createSettingsManager(dir)
    const reloaded = await mgr2.load()
    expect(reloaded.clientPath).toBe('C:/Dark Ages/Darkages.exe')
    expect(reloaded.theme).toBe('danaan')
    expect(reloaded.hideWalls).toBe(true)
  })

  it('keeps the save queue alive after a save failure', async () => {
    const mgr = createSettingsManager(dir)
    const base = await mgr.load()

    // Circular reference forces JSON.stringify to throw inside the queue's
    // doSave step — pre-fix this would poison the queue and silently no-op
    // every subsequent save.
    const poison = { ...base }
    poison.self = poison
    await expect(mgr.save(poison)).rejects.toThrow()

    await mgr.save({ ...base, theme: 'recovered' })
    const reloaded = await createSettingsManager(dir).load()
    expect(reloaded.theme).toBe('recovered')
  })

  it('queues concurrent saves without clobbering', async () => {
    const mgr = createSettingsManager(dir)
    const base = await mgr.load()
    await Promise.all([
      mgr.save({ ...base, theme: 'spark' }),
      mgr.save({ ...base, theme: 'grinneal' })
    ])

    const reloaded = await createSettingsManager(dir).load()
    expect(['spark', 'grinneal']).toContain(reloaded.theme)
  })

  it('writes a backup of the previous primary on subsequent save', async () => {
    const mgr = createSettingsManager(dir)
    const base = await mgr.load()
    await mgr.save({ ...base, theme: 'spark' })
    await mgr.save({ ...base, theme: 'chadul' })

    const backup = JSON.parse(await fs.readFile(join(dir, 'settings.bak.json'), 'utf-8'))
    expect(backup.theme).toBe('spark')
    const primary = JSON.parse(await fs.readFile(join(dir, 'settings.json'), 'utf-8'))
    expect(primary.theme).toBe('chadul')
  })

  // If you add a new top-level setting, also add it here with a non-default
  // value. Guards against the withDefaults allowlist trap: forgetting to wire
  // a new field through withDefaults silently strips it on next load.
  it('round-trips every documented top-level field', async () => {
    const sample = {
      targetKind: 'hybrasyl',
      clientPath: 'C:/round-trip/Darkages.exe',
      version: '7.41',
      skipIntro: false,
      multipleInstances: false,
      hideWalls: true,
      theme: 'chadul',
      activeProfile: 'custom',
      profiles: [
        { id: 'custom', name: 'Custom', hostname: 'rt.example', port: 1234, redirect: true }
      ],
      targets: {
        hybrasyl: {
          mode: 'repo',
          binaryPath: 'D:/prebuilt/client.exe',
          clientRepoPath: 'D:/client-repo/Hybrasyl.Client/Hybrasyl.Client.csproj',
          clientBranch: 'feature/foo',
          noGit: false,
          autoSaveLogs: true
        }
      },
      instances: [
        {
          id: 'inst-rt',
          name: 'Round-Trip',
          mode: 'repo',
          binaryPath: 'D:/hyb/Hybrasyl.dll',
          serverRepoPath: 'D:/server',
          serverBranch: 'develop',
          serverNoGit: false,
          xmlRepoPath: 'D:/xml',
          xmlBranch: 'main',
          xmlNoGit: false,
          worldDirectoryId: 'wd-rt',
          logDir: 'D:/logs',
          configFileName: 'local.xml',
          redisHost: 'rt-redis',
          redisPort: 6380,
          redisDatabase: 5,
          redisPassword: 'rt-pw',
          lobbyPort: 3610,
          loginPort: 3611,
          worldPort: 3612
        }
      ],
      activeInstance: 'inst-rt',
      worldDirectories: [{ id: 'wd-rt', name: 'world', path: 'D:/Hybrasyl/world' }],
      activeWorldDirectory: 'wd-rt'
    }

    const mgr = createSettingsManager(dir)
    await mgr.save(sample)
    const reloaded = await createSettingsManager(dir).load()
    expect(reloaded).toEqual(sample)
  })
})

describe('legacy flat-field migration', () => {
  it('converts serverHostname/serverPort/redirectServer into a migrated profile', async () => {
    const legacy = {
      serverHostname: 'test.hybrasyl.com',
      serverPort: 2611,
      redirectServer: true,
      clientPath: 'C:/Darkages.exe'
    }
    await fs.writeFile(join(dir, 'settings.json'), JSON.stringify(legacy), 'utf-8')

    const settings = await createSettingsManager(dir).load()

    expect(settings.profiles).toHaveLength(2)
    const migrated = settings.profiles.find((p) => p.id === 'migrated')
    expect(migrated).toBeDefined()
    expect(migrated.hostname).toBe('test.hybrasyl.com')
    expect(migrated.port).toBe(2611)
    expect(migrated.redirect).toBe(true)
    expect(settings.activeProfile).toBe('migrated')
  })

  it('leaves only default profile when legacy hostname matches the official server', async () => {
    const legacy = {
      serverHostname: 'da0.kru.com',
      serverPort: 2610,
      redirectServer: false
    }
    await fs.writeFile(join(dir, 'settings.json'), JSON.stringify(legacy), 'utf-8')

    const settings = await createSettingsManager(dir).load()

    expect(settings.profiles).toHaveLength(1)
    expect(settings.profiles[0].id).toBe('official')
    expect(settings.activeProfile).toBe('official')
  })

  it('drops the legacy flat fields after migration', async () => {
    const legacy = {
      serverHostname: 'custom.example.com',
      serverPort: 9999,
      redirectServer: true
    }
    await fs.writeFile(join(dir, 'settings.json'), JSON.stringify(legacy), 'utf-8')

    const mgr = createSettingsManager(dir)
    const settings = await mgr.load()
    await mgr.save(settings)

    const onDisk = JSON.parse(await fs.readFile(join(dir, 'settings.json'), 'utf-8'))
    expect(onDisk.serverHostname).toBeUndefined()
    expect(onDisk.serverPort).toBeUndefined()
    expect(onDisk.redirectServer).toBeUndefined()
  })
})

describe('targetKind', () => {
  it('defaults to legacy when no settings file exists', async () => {
    const settings = await createSettingsManager(dir).load()
    expect(settings.targetKind).toBe('legacy')
  })

  it('migrates pre-Stage-1 settings (without targetKind) to legacy', async () => {
    const preStage1 = {
      clientPath: 'C:/Darkages.exe',
      theme: 'danaan',
      profiles: [
        {
          id: 'official',
          name: 'Dark Ages (Official)',
          hostname: 'da0.kru.com',
          port: 2610,
          redirect: false
        }
      ],
      activeProfile: 'official'
    }
    await fs.writeFile(join(dir, 'settings.json'), JSON.stringify(preStage1), 'utf-8')

    const settings = await createSettingsManager(dir).load()
    expect(settings.targetKind).toBe('legacy')
    expect(settings.clientPath).toBe('C:/Darkages.exe')
    expect(settings.theme).toBe('danaan')
  })

  it('preserves a non-default targetKind already in settings', async () => {
    const future = { targetKind: 'hybrasyl', clientPath: '' }
    await fs.writeFile(join(dir, 'settings.json'), JSON.stringify(future), 'utf-8')

    const settings = await createSettingsManager(dir).load()
    expect(settings.targetKind).toBe('hybrasyl')
  })

  it('replaces a non-string targetKind with the legacy default', async () => {
    const garbage = { targetKind: 42 }
    await fs.writeFile(join(dir, 'settings.json'), JSON.stringify(garbage), 'utf-8')

    const settings = await createSettingsManager(dir).load()
    expect(settings.targetKind).toBe('legacy')
  })
})

describe('targets.hybrasyl', () => {
  it('defaults to binary mode with empty paths and auto-save off', async () => {
    const settings = await createSettingsManager(dir).load()
    expect(settings.targets.hybrasyl.mode).toBe('binary')
    expect(settings.targets.hybrasyl.binaryPath).toBe('')
    expect(settings.targets.hybrasyl.clientRepoPath).toBe('')
    expect(settings.targets.hybrasyl.clientBranch).toBeNull()
    expect(settings.targets.hybrasyl.autoSaveLogs).toBe(false)
    expect(settings.targets.hybrasyl.showConsole).toBeUndefined()
  })

  it('fills in hybrasyl defaults when pre-Stage-2 settings lack a targets key', async () => {
    const preStage2 = {
      targetKind: 'legacy',
      clientPath: 'C:/Darkages.exe',
      profiles: [
        {
          id: 'official',
          name: 'Dark Ages (Official)',
          hostname: 'da0.kru.com',
          port: 2610,
          redirect: false
        }
      ],
      activeProfile: 'official'
    }
    await fs.writeFile(join(dir, 'settings.json'), JSON.stringify(preStage2), 'utf-8')

    const settings = await createSettingsManager(dir).load()
    expect(settings.targets.hybrasyl.mode).toBe('binary')
    expect(settings.targets.hybrasyl.binaryPath).toBe('')
    expect(settings.targets.hybrasyl.clientRepoPath).toBe('')
  })

  it('preserves existing hybrasyl settings on round-trip', async () => {
    const mgr = createSettingsManager(dir)
    const base = await mgr.load()
    await mgr.save({
      ...base,
      targets: {
        hybrasyl: {
          mode: 'repo',
          binaryPath: '',
          clientRepoPath: 'D:/client-repo/Hybrasyl.Client/Hybrasyl.Client.csproj',
          clientBranch: 'develop',
          autoSaveLogs: true
        }
      }
    })

    const reloaded = await createSettingsManager(dir).load()
    expect(reloaded.targets.hybrasyl.mode).toBe('repo')
    expect(reloaded.targets.hybrasyl.clientRepoPath).toBe(
      'D:/client-repo/Hybrasyl.Client/Hybrasyl.Client.csproj'
    )
    expect(reloaded.targets.hybrasyl.clientBranch).toBe('develop')
    expect(reloaded.targets.hybrasyl.autoSaveLogs).toBe(true)
  })

  it('fills in defaults for missing fields when targets.hybrasyl is partial', async () => {
    const partial = {
      targets: { hybrasyl: { mode: 'binary', binaryPath: 'D:/client.exe' } }
    }
    await fs.writeFile(join(dir, 'settings.json'), JSON.stringify(partial), 'utf-8')

    const settings = await createSettingsManager(dir).load()
    expect(settings.targets.hybrasyl.mode).toBe('binary')
    expect(settings.targets.hybrasyl.binaryPath).toBe('D:/client.exe')
    expect(settings.targets.hybrasyl.clientRepoPath).toBe('')
    expect(settings.targets.hybrasyl.clientBranch).toBeNull()
    expect(settings.targets.hybrasyl.autoSaveLogs).toBe(false)
  })

  it('replaces wrong-typed hybrasyl fields with defaults', async () => {
    const garbage = {
      targets: {
        hybrasyl: {
          mode: 42,
          binaryPath: 99,
          clientRepoPath: null,
          clientBranch: true,
          autoSaveLogs: 'yes'
        }
      }
    }
    await fs.writeFile(join(dir, 'settings.json'), JSON.stringify(garbage), 'utf-8')

    const settings = await createSettingsManager(dir).load()
    expect(settings.targets.hybrasyl.mode).toBe('binary')
    expect(settings.targets.hybrasyl.binaryPath).toBe('')
    expect(settings.targets.hybrasyl.clientRepoPath).toBe('')
    expect(settings.targets.hybrasyl.clientBranch).toBeNull()
    expect(settings.targets.hybrasyl.autoSaveLogs).toBe(false)
  })

  it('round-trips an autoSaveLogs=true preference', async () => {
    const mgr = createSettingsManager(dir)
    const base = await mgr.load()
    await mgr.save({
      ...base,
      targets: { hybrasyl: { ...base.targets.hybrasyl, autoSaveLogs: true } }
    })

    const reloaded = await createSettingsManager(dir).load()
    expect(reloaded.targets.hybrasyl.autoSaveLogs).toBe(true)
  })

  it('drops a legacy showConsole field on load (renamed to autoSaveLogs schema)', async () => {
    const legacy = {
      targets: {
        hybrasyl: {
          mode: 'binary',
          binaryPath: 'D:/client.exe',
          clientRepoPath: '',
          clientBranch: null,
          showConsole: true
        }
      }
    }
    await fs.writeFile(join(dir, 'settings.json'), JSON.stringify(legacy), 'utf-8')

    const mgr = createSettingsManager(dir)
    const settings = await mgr.load()
    expect(settings.targets.hybrasyl.showConsole).toBeUndefined()
    expect(settings.targets.hybrasyl.autoSaveLogs).toBe(false)
    expect(settings.targets.hybrasyl.binaryPath).toBe('D:/client.exe')

    await mgr.save(settings)
    const onDisk = JSON.parse(await fs.readFile(join(dir, 'settings.json'), 'utf-8'))
    expect(onDisk.targets.hybrasyl.showConsole).toBeUndefined()
  })

  it('migrates settings.targets.chaos (legacy stage-2 key) to .hybrasyl', async () => {
    const stage2 = {
      targets: {
        chaos: {
          clientPath: 'D:/client.exe',
          dataPath: 'D:/DA',
          showConsole: true
        }
      }
    }
    await fs.writeFile(join(dir, 'settings.json'), JSON.stringify(stage2), 'utf-8')

    const mgr = createSettingsManager(dir)
    const settings = await mgr.load()

    // After both migrations: chaos→hybrasyl, then old shape→mode-split.
    // showConsole is dropped — replaced by autoSaveLogs which defaults off.
    expect(settings.targets.hybrasyl.mode).toBe('binary')
    expect(settings.targets.hybrasyl.binaryPath).toBe('D:/client.exe')
    expect(settings.targets.hybrasyl.showConsole).toBeUndefined()
    expect(settings.targets.hybrasyl.autoSaveLogs).toBe(false)

    await mgr.save(settings)
    const onDisk = JSON.parse(await fs.readFile(join(dir, 'settings.json'), 'utf-8'))
    expect(onDisk.targets.chaos).toBeUndefined()
    expect(onDisk.targets.hybrasyl.binaryPath).toBe('D:/client.exe')
    expect(onDisk.targets.hybrasyl.clientPath).toBeUndefined()
    expect(onDisk.targets.hybrasyl.dataPath).toBeUndefined()
    expect(onDisk.targets.hybrasyl.showConsole).toBeUndefined()
  })

  it('migrates an old-shape .exe clientPath to mode=binary + binaryPath', async () => {
    const old = {
      targets: {
        hybrasyl: {
          clientPath: 'D:/client.exe',
          dataPath: 'D:/DA',
          showConsole: true
        }
      }
    }
    await fs.writeFile(join(dir, 'settings.json'), JSON.stringify(old), 'utf-8')

    const mgr = createSettingsManager(dir)
    const settings = await mgr.load()
    expect(settings.targets.hybrasyl.mode).toBe('binary')
    expect(settings.targets.hybrasyl.binaryPath).toBe('D:/client.exe')
    expect(settings.targets.hybrasyl.clientRepoPath).toBe('')
    expect(settings.targets.hybrasyl.clientBranch).toBeNull()
    expect(settings.targets.hybrasyl.showConsole).toBeUndefined()
    expect(settings.targets.hybrasyl.autoSaveLogs).toBe(false)

    await mgr.save(settings)
    const onDisk = JSON.parse(await fs.readFile(join(dir, 'settings.json'), 'utf-8'))
    expect(onDisk.targets.hybrasyl.clientPath).toBeUndefined()
    expect(onDisk.targets.hybrasyl.dataPath).toBeUndefined()
    expect(onDisk.targets.hybrasyl.showConsole).toBeUndefined()
  })

  it('migrates an old-shape .csproj clientPath to mode=repo + clientRepoPath', async () => {
    const old = {
      targets: {
        hybrasyl: {
          clientPath: 'D:/client-repo/Hybrasyl.Client/Hybrasyl.Client.csproj',
          dataPath: 'D:/DA'
        }
      }
    }
    await fs.writeFile(join(dir, 'settings.json'), JSON.stringify(old), 'utf-8')

    const settings = await createSettingsManager(dir).load()
    expect(settings.targets.hybrasyl.mode).toBe('repo')
    expect(settings.targets.hybrasyl.binaryPath).toBe('')
    expect(settings.targets.hybrasyl.clientRepoPath).toBe(
      'D:/client-repo/Hybrasyl.Client/Hybrasyl.Client.csproj'
    )
    expect(settings.targets.hybrasyl.clientBranch).toBeNull()
  })
})

describe('instances', () => {
  it('defaults to an empty array', async () => {
    const settings = await createSettingsManager(dir).load()
    expect(settings.instances).toEqual([])
    expect(settings.activeInstance).toBeNull()
  })

  it('preserves valid instances across a round-trip', async () => {
    const mgr = createSettingsManager(dir)
    const base = await mgr.load()
    const worldDir = { id: 'wd-1', name: 'ceridwen', path: 'D:/ceridwen' }
    const instance = {
      id: 'inst-1',
      name: 'QA',
      mode: 'binary',
      binaryPath: 'D:/hyb/Hybrasyl.dll',
      serverRepoPath: '',
      serverBranch: null,
      serverNoGit: false,
      xmlRepoPath: '',
      xmlBranch: null,
      xmlNoGit: false,
      worldDirectoryId: 'wd-1',
      logDir: 'D:/hyb-logs',
      configFileName: 'config.xml',
      redisHost: 'localhost',
      redisPort: 6379,
      redisDatabase: null,
      redisPassword: '',
      lobbyPort: 2610,
      loginPort: 2611,
      worldPort: 2612
    }
    await mgr.save({
      ...base,
      instances: [instance],
      activeInstance: 'inst-1',
      worldDirectories: [worldDir],
      activeWorldDirectory: 'wd-1'
    })

    const reloaded = await createSettingsManager(dir).load()
    expect(reloaded.instances).toHaveLength(1)
    expect(reloaded.instances[0]).toEqual(instance)
    expect(reloaded.activeInstance).toBe('inst-1')
    expect(reloaded.worldDirectories).toEqual([worldDir])
    expect(reloaded.activeWorldDirectory).toBe('wd-1')
  })

  it('fills missing fields on each instance with defaults', async () => {
    const partial = {
      instances: [{ id: 'inst-1', name: 'Bare', mode: 'binary' }]
    }
    await fs.writeFile(join(dir, 'settings.json'), JSON.stringify(partial), 'utf-8')

    const settings = await createSettingsManager(dir).load()
    const i = settings.instances[0]
    // Redis fields default to "don't override" — server reads XML DataStore.
    expect(i.redisHost).toBe('')
    expect(i.redisPort).toBe(6379)
    expect(i.redisDatabase).toBeNull()
    expect(i.redisPassword).toBe('')
    expect(i.lobbyPort).toBe(2610)
    expect(i.loginPort).toBe(2611)
    expect(i.worldPort).toBe(2612)
    expect(i.configFileName).toBe('')
    expect(i.serverBranch).toBeNull()
    expect(i.xmlBranch).toBeNull()
  })

  it('filters out instances with no id so the list never contains garbage', async () => {
    const junk = {
      instances: [{ id: 'good', name: 'ok' }, { name: 'no-id' }, null, 'not-an-object']
    }
    await fs.writeFile(join(dir, 'settings.json'), JSON.stringify(junk), 'utf-8')

    const settings = await createSettingsManager(dir).load()
    expect(settings.instances).toHaveLength(1)
    expect(settings.instances[0].id).toBe('good')
  })

  it('falls back to binary mode when mode is an unknown value', async () => {
    const weird = {
      instances: [{ id: 'i1', mode: 'lolwhat' }]
    }
    await fs.writeFile(join(dir, 'settings.json'), JSON.stringify(weird), 'utf-8')

    const settings = await createSettingsManager(dir).load()
    expect(settings.instances[0].mode).toBe('binary')
  })

  it('fills repo-mode path/branch fields with empty defaults on a bare instance', async () => {
    // Pre-Stage-3.1 instances saved before repo mode existed will have no
    // serverRepoPath/xmlRepoPath at all — confirm coerceInstance fills them.
    const bare = { instances: [{ id: 'i1' }] }
    await fs.writeFile(join(dir, 'settings.json'), JSON.stringify(bare), 'utf-8')

    const settings = await createSettingsManager(dir).load()
    const i = settings.instances[0]
    expect(i.mode).toBe('binary')
    expect(i.binaryPath).toBe('')
    expect(i.serverRepoPath).toBe('')
    expect(i.xmlRepoPath).toBe('')
    expect(i.serverBranch).toBeNull()
    expect(i.xmlBranch).toBeNull()
  })

  it('preserves null branches (no override) but rejects wrong-typed branches', async () => {
    const data = {
      instances: [
        { id: 'keep-null', mode: 'repo', serverBranch: null, xmlBranch: null },
        { id: 'coerce', mode: 'repo', serverBranch: 42, xmlBranch: true }
      ]
    }
    await fs.writeFile(join(dir, 'settings.json'), JSON.stringify(data), 'utf-8')

    const settings = await createSettingsManager(dir).load()
    expect(settings.instances[0].serverBranch).toBeNull()
    expect(settings.instances[0].xmlBranch).toBeNull()
    expect(settings.instances[1].serverBranch).toBeNull()
    expect(settings.instances[1].xmlBranch).toBeNull()
  })
})

describe('withDefaults field coercion', () => {
  it('fills in missing fields without losing valid user values', async () => {
    const partial = {
      clientPath: 'C:/some/path.exe',
      profiles: [{ id: 'a', name: 'A', hostname: 'a.example.com', port: 1234, redirect: false }],
      activeProfile: 'a'
    }
    await fs.writeFile(join(dir, 'settings.json'), JSON.stringify(partial), 'utf-8')

    const settings = await createSettingsManager(dir).load()

    expect(settings.clientPath).toBe('C:/some/path.exe')
    expect(settings.theme).toBe('hybrasyl')
    expect(settings.skipIntro).toBe(true)
    expect(settings.activeProfile).toBe('a')
  })

  it('replaces wrong-typed fields with defaults', async () => {
    const garbage = {
      clientPath: 12345,
      skipIntro: 'yes',
      hideWalls: 'true',
      profiles: []
    }
    await fs.writeFile(join(dir, 'settings.json'), JSON.stringify(garbage), 'utf-8')

    const settings = await createSettingsManager(dir).load()

    expect(settings.clientPath).toBe('')
    expect(settings.skipIntro).toBe(true)
    expect(settings.hideWalls).toBe(false)
    expect(settings.profiles).toHaveLength(1)
  })
})

describe('worldDirectories migration', () => {
  it('synthesizes a worldDirectories entry from a legacy instance.dataDir', async () => {
    const legacy = {
      instances: [{ id: 'i1', name: 'QA', mode: 'binary', dataDir: 'D:/Hybrasyl/world' }]
    }
    await fs.writeFile(join(dir, 'settings.json'), JSON.stringify(legacy), 'utf-8')

    const settings = await createSettingsManager(dir).load()
    expect(settings.worldDirectories).toHaveLength(1)
    const wd = settings.worldDirectories[0]
    expect(wd.path).toBe('D:/Hybrasyl/world')
    expect(wd.name).toBe('world')
    expect(wd.id).toMatch(/^[0-9a-f-]{36}$/) // UUID

    expect(settings.instances[0].worldDirectoryId).toBe(wd.id)
    expect(settings.instances[0].dataDir).toBeUndefined()
    expect(settings.activeWorldDirectory).toBe(wd.id)
  })

  it('dedupes legacy paths case-insensitively and across slash flavors', async () => {
    const legacy = {
      instances: [
        { id: 'a', dataDir: 'D:/Hybrasyl/world' },
        { id: 'b', dataDir: 'D:\\Hybrasyl\\world' }, // backslashes
        { id: 'c', dataDir: 'd:/HYBRASYL/world/' } // case + trailing slash
      ]
    }
    await fs.writeFile(join(dir, 'settings.json'), JSON.stringify(legacy), 'utf-8')

    const settings = await createSettingsManager(dir).load()
    expect(settings.worldDirectories).toHaveLength(1)
    const id = settings.worldDirectories[0].id
    expect(settings.instances.map((i) => i.worldDirectoryId)).toEqual([id, id, id])
  })

  it('preserves an existing worldDirectories list and reuses entries on migration', async () => {
    const data = {
      worldDirectories: [{ id: 'pre-existing', name: 'world', path: 'D:/Hybrasyl/world' }],
      activeWorldDirectory: 'pre-existing',
      instances: [{ id: 'i1', dataDir: 'D:/Hybrasyl/world' }]
    }
    await fs.writeFile(join(dir, 'settings.json'), JSON.stringify(data), 'utf-8')

    const settings = await createSettingsManager(dir).load()
    expect(settings.worldDirectories).toHaveLength(1)
    expect(settings.worldDirectories[0].id).toBe('pre-existing')
    expect(settings.instances[0].worldDirectoryId).toBe('pre-existing')
  })

  it('leaves migrated instances alone (idempotent)', async () => {
    const data = {
      worldDirectories: [{ id: 'wd-1', name: 'world', path: 'D:/Hybrasyl/world' }],
      activeWorldDirectory: 'wd-1',
      instances: [{ id: 'i1', worldDirectoryId: 'wd-1' }]
    }
    await fs.writeFile(join(dir, 'settings.json'), JSON.stringify(data), 'utf-8')

    const settings = await createSettingsManager(dir).load()
    expect(settings.worldDirectories).toHaveLength(1)
    expect(settings.instances[0].worldDirectoryId).toBe('wd-1')
  })

  it('drops invalid worldDirectories entries (missing id or path)', async () => {
    const data = {
      worldDirectories: [
        { id: 'good', name: 'world', path: 'D:/world' },
        { name: 'no-id' },
        { id: 'no-path' },
        null
      ]
    }
    await fs.writeFile(join(dir, 'settings.json'), JSON.stringify(data), 'utf-8')

    const settings = await createSettingsManager(dir).load()
    expect(settings.worldDirectories).toHaveLength(1)
    expect(settings.worldDirectories[0].id).toBe('good')
  })
})

describe('renameWithRetry behavior', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function ePermError() {
    const err = new Error('EPERM: operation not permitted, rename')
    err.code = 'EPERM'
    return err
  }

  it('retries on EPERM and succeeds on later attempt', async () => {
    const renameSpy = vi
      .spyOn(fs, 'rename')
      .mockImplementationOnce(() => Promise.reject(ePermError()))
    const mgr = createSettingsManager(dir)
    const original = await mgr.load()

    await mgr.save({ ...original, theme: 'chadul' })

    expect(renameSpy).toHaveBeenCalledTimes(2)
    const reloaded = await createSettingsManager(dir).load()
    expect(reloaded.theme).toBe('chadul')
  })

  it('falls back to unlink + rename after retries exhaust', async () => {
    const renameSpy = vi
      .spyOn(fs, 'rename')
      .mockImplementationOnce(() => Promise.reject(ePermError()))
      .mockImplementationOnce(() => Promise.reject(ePermError()))
      .mockImplementationOnce(() => Promise.reject(ePermError()))
    const unlinkSpy = vi.spyOn(fs, 'unlink')

    const mgr = createSettingsManager(dir)
    const original = await mgr.load()
    await mgr.save({ ...original, theme: 'danaan' })

    expect(renameSpy).toHaveBeenCalledTimes(4)
    expect(unlinkSpy).toHaveBeenCalledWith(join(dir, 'settings.json'))

    const reloaded = await createSettingsManager(dir).load()
    expect(reloaded.theme).toBe('danaan')
  })

  it('re-throws non-EPERM errors without retrying', async () => {
    const enospc = new Error('ENOSPC: no space left on device')
    enospc.code = 'ENOSPC'
    const renameSpy = vi.spyOn(fs, 'rename').mockImplementationOnce(() => Promise.reject(enospc))
    // Suppress the resilience-pattern's console.error so the test output stays clean.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const mgr = createSettingsManager(dir)
    const original = await mgr.load()
    await expect(mgr.save({ ...original, theme: 'grinneal' })).rejects.toThrow(/ENOSPC/)

    expect(renameSpy).toHaveBeenCalledTimes(1)
    errSpy.mockRestore()
  })
})
