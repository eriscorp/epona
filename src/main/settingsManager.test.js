import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
      profiles: [{ id: 'official', name: 'Dark Ages (Official)', hostname: 'da0.kru.com', port: 2610, redirect: false }],
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
      profiles: [{ id: 'official', name: 'Dark Ages (Official)', hostname: 'da0.kru.com', port: 2610, redirect: false }],
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
  it('defaults to empty clientPath, the game data path, and a hidden console', async () => {
    const settings = await createSettingsManager(dir).load()
    expect(settings.targets.hybrasyl.clientPath).toBe('')
    expect(settings.targets.hybrasyl.dataPath).toBe('E:\\Games\\Dark Ages')
    expect(settings.targets.hybrasyl.showConsole).toBe(false)
  })

  it('fills in hybrasyl defaults when pre-Stage-2 settings lack a targets key', async () => {
    const preStage2 = {
      targetKind: 'legacy',
      clientPath: 'C:/Darkages.exe',
      profiles: [{ id: 'official', name: 'Dark Ages (Official)', hostname: 'da0.kru.com', port: 2610, redirect: false }],
      activeProfile: 'official'
    }
    await fs.writeFile(join(dir, 'settings.json'), JSON.stringify(preStage2), 'utf-8')

    const settings = await createSettingsManager(dir).load()
    expect(settings.targets.hybrasyl.clientPath).toBe('')
    expect(settings.targets.hybrasyl.dataPath).toBe('E:\\Games\\Dark Ages')
  })

  it('preserves existing hybrasyl settings on round-trip', async () => {
    const mgr = createSettingsManager(dir)
    const base = await mgr.load()
    await mgr.save({
      ...base,
      targets: { hybrasyl: { clientPath: 'D:/client-repo/bin/Release/net10.0/client.exe', dataPath: 'D:/DA' } }
    })

    const reloaded = await createSettingsManager(dir).load()
    expect(reloaded.targets.hybrasyl.clientPath).toBe('D:/client-repo/bin/Release/net10.0/client.exe')
    expect(reloaded.targets.hybrasyl.dataPath).toBe('D:/DA')
  })

  it('fills in only the missing field when targets.hybrasyl is partial', async () => {
    const partial = {
      targets: { hybrasyl: { clientPath: 'D:/client.exe' } }
    }
    await fs.writeFile(join(dir, 'settings.json'), JSON.stringify(partial), 'utf-8')

    const settings = await createSettingsManager(dir).load()
    expect(settings.targets.hybrasyl.clientPath).toBe('D:/client.exe')
    expect(settings.targets.hybrasyl.dataPath).toBe('E:\\Games\\Dark Ages')
  })

  it('replaces wrong-typed hybrasyl fields with defaults', async () => {
    const garbage = {
      targets: { hybrasyl: { clientPath: 42, dataPath: null, showConsole: 'yes' } }
    }
    await fs.writeFile(join(dir, 'settings.json'), JSON.stringify(garbage), 'utf-8')

    const settings = await createSettingsManager(dir).load()
    expect(settings.targets.hybrasyl.clientPath).toBe('')
    expect(settings.targets.hybrasyl.dataPath).toBe('E:\\Games\\Dark Ages')
    expect(settings.targets.hybrasyl.showConsole).toBe(false)
  })

  it('round-trips a showConsole=true preference', async () => {
    const mgr = createSettingsManager(dir)
    const base = await mgr.load()
    await mgr.save({
      ...base,
      targets: { hybrasyl: { ...base.targets.hybrasyl, showConsole: true } }
    })

    const reloaded = await createSettingsManager(dir).load()
    expect(reloaded.targets.hybrasyl.showConsole).toBe(true)
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

    expect(settings.targets.hybrasyl.clientPath).toBe('D:/client.exe')
    expect(settings.targets.hybrasyl.dataPath).toBe('D:/DA')
    expect(settings.targets.hybrasyl.showConsole).toBe(true)

    await mgr.save(settings)
    const onDisk = JSON.parse(await fs.readFile(join(dir, 'settings.json'), 'utf-8'))
    expect(onDisk.targets.chaos).toBeUndefined()
    expect(onDisk.targets.hybrasyl.clientPath).toBe('D:/client.exe')
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
