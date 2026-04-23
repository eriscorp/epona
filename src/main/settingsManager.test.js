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
