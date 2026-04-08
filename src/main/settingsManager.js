import { join } from 'path'
import { promises as fs } from 'fs'

const DEFAULT_PROFILES = [
  {
    id: 'official',
    name: 'Dark Ages (Official)',
    hostname: 'da0.kru.com',
    port: 2610,
    redirect: false
  }
]

const DEFAULTS = {
  clientPath: '',
  version: 'auto',
  skipIntro: true,
  multipleInstances: true,
  hideWalls: false,
  theme: 'hybrasyl',
  activeProfile: 'official',
  profiles: DEFAULT_PROFILES
}

function validate(data) {
  if (!data || typeof data !== 'object') return false
  return true
}

function migrateProfiles(data) {
  // Migrate from flat serverHostname/serverPort/redirectServer to profiles
  if (data && !Array.isArray(data.profiles)) {
    const profiles = [...DEFAULT_PROFILES]
    if (data.serverHostname && data.serverHostname !== 'da0.kru.com') {
      profiles.push({
        id: 'migrated',
        name: 'Custom Server',
        hostname: data.serverHostname,
        port: data.serverPort || 2610,
        redirect: true
      })
    }
    data.profiles = profiles
    data.activeProfile = data.redirectServer ? 'migrated' : 'official'
    delete data.serverHostname
    delete data.serverPort
    delete data.redirectServer
  }
  return data
}

function withDefaults(data) {
  data = migrateProfiles(data)
  return {
    clientPath: typeof data?.clientPath === 'string' ? data.clientPath : DEFAULTS.clientPath,
    version: data?.version ?? DEFAULTS.version,
    skipIntro: typeof data?.skipIntro === 'boolean' ? data.skipIntro : DEFAULTS.skipIntro,
    multipleInstances:
      typeof data?.multipleInstances === 'boolean'
        ? data.multipleInstances
        : DEFAULTS.multipleInstances,
    hideWalls: typeof data?.hideWalls === 'boolean' ? data.hideWalls : DEFAULTS.hideWalls,
    theme: typeof data?.theme === 'string' ? data.theme : DEFAULTS.theme,
    activeProfile: typeof data?.activeProfile === 'string' ? data.activeProfile : DEFAULTS.activeProfile,
    profiles: Array.isArray(data?.profiles) && data.profiles.length > 0
      ? data.profiles
      : DEFAULTS.profiles
  }
}

async function tryReadJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!validate(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

export function createSettingsManager(userDataPath) {
  const primary = join(userDataPath, 'settings.json')
  const backup = join(userDataPath, 'settings.bak.json')
  const tmp = join(userDataPath, 'settings.tmp.json')

  async function load() {
    let data = await tryReadJson(primary)
    if (data) return withDefaults(data)

    console.warn('settings.json unreadable, trying backup')
    data = await tryReadJson(backup)
    if (data) {
      console.warn('Recovered settings from backup')
      await save(withDefaults(data))
      return withDefaults(data)
    }

    console.warn('No valid settings found, using defaults')
    return { ...DEFAULTS, profiles: [...DEFAULT_PROFILES] }
  }

  let saveQueue = Promise.resolve()

  function save(data) {
    saveQueue = saveQueue.then(async () => {
      const content = JSON.stringify(data, null, 2)
      await fs.mkdir(userDataPath, { recursive: true })
      await fs.writeFile(tmp, content, 'utf-8')
      try {
        await fs.copyFile(primary, backup)
      } catch {
        /* primary may not exist yet */
      }
      await fs.rename(tmp, primary)
    })
    return saveQueue
  }

  return { load, save }
}
